import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// scraper.js -> lib/supabase.js throws unless these are set; no network call is
// made at import time (createClient does not connect eagerly), so any truthy
// values are fine here.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';

const {
  parsePrizeAmount, mlhEventYear, mlhSeasons, mlhEventDates, toISO, stripHTML, isGenericSkill,
  isHackathonTitle,
} =
  await import('../src/jobs/scraper.js');

describe('parsePrizeAmount', () => {
  test('plain dollar amount with thousands separators', () => {
    assert.equal(parsePrizeAmount('$50,000'), 50000);
  });

  // Lakh/crore are Indian shorthand — stripping non-digits would read "1.5 Lakh"
  // as 1.5, undercounting by 100,000x.
  test('Indian lakh shorthand', () => {
    assert.equal(parsePrizeAmount('₹1.5 Lakh'), 150000);
  });

  test('crore shorthand', () => {
    assert.equal(parsePrizeAmount('2 Cr'), 20000000);
  });

  test('K shorthand', () => {
    assert.equal(parsePrizeAmount('10K'), 10000);
  });

  test('million word form', () => {
    assert.equal(parsePrizeAmount('$1.2 million'), 1200000);
  });

  // Devpost's API returns prize_amount as HTML, not plain text.
  test('Devpost HTML span form', () => {
    assert.equal(parsePrizeAmount('$<span data-currency-value>740,000</span>'), 740000);
  });

  test('null is treated as no prize', () => {
    assert.equal(parsePrizeAmount(null), 0);
  });

  test('TBA is treated as no prize', () => {
    assert.equal(parsePrizeAmount('TBA'), 0);
  });

  test('a number is passed through, floored', () => {
    assert.equal(parsePrizeAmount(12345.9), 12345);
  });
});

describe('mlhEventYear', () => {
  // Season N is named for the year it ENDS in, so its autumn (Aug-Dec) events
  // actually happened the calendar year before the season number.
  test('autumn month resolves to season - 1', () => {
    assert.equal(mlhEventYear('OCT', '2027'), '2026');
  });

  test('non-autumn month resolves to the season itself', () => {
    assert.equal(mlhEventYear('JAN', '2027'), '2027');
  });
});

describe('mlhSeasons', () => {
  test('from August onward, already inside next year\'s season', () => {
    assert.deepEqual(mlhSeasons(new Date('2026-09-20')), ['2027', '2028']);
  });

  test('before August, still inside the current season', () => {
    assert.deepEqual(mlhSeasons(new Date('2026-03-01')), ['2026', '2027']);
  });
});

describe('stripHTML', () => {
  test('removes tags and decodes common entities', () => {
    assert.equal(stripHTML('<b>Fish &amp; Chips</b>'), 'Fish & Chips');
  });

  test('collapses whitespace', () => {
    assert.equal(stripHTML('a   b\n\tc'), 'a b c');
  });

  test('passes non-strings through unchanged', () => {
    assert.equal(stripHTML(null), null);
  });
});

// Unstop tags every hackathon with AI-generated soft skills. If this filter is
// too broad it silently deletes real subjects; too narrow and the noise buries
// them in the domain dropdown. Both failures are invisible without this test.
describe('isGenericSkill', () => {
  test('drops skills that apply to every hackathon', () => {
    for (const s of [
      'Problem Solving', 'Teamwork and Collaboration', 'Creativity', 'Creative Thinking',
      'Public Speaking and Presentation Skills', 'Ideation', 'Innovation Management',
      'Technical Skills', 'Communication', 'Critical Thinking', 'Leadership',
    ]) {
      assert.equal(isGenericSkill(s), true, `expected "${s}" to be filtered out`);
    }
  });

  test('keeps real subject matter', () => {
    for (const s of [
      'Python', 'React.js', 'Artificial Intelligence (AI)', 'Data Structures and Algorithms',
      'Robotics Kinematics', 'Electronics Engineering', 'IoT Sensor Integration',
      'Machine Learning Concepts', 'C++ Programming Language', 'Beginner Friendly',
    ]) {
      assert.equal(isGenericSkill(s), false, `expected "${s}" to be kept`);
    }
  });
});

// Each case below is a bug that was actually present.
describe('parsePrizeAmount shorthand that used to be missed', () => {
  test('plural lakh/lac — the 100,000x undercount', () => {
    assert.equal(parsePrizeAmount('10 Lakhs'), 1_000_000);
    assert.equal(parsePrizeAmount('₹1.5 Lakhs'), 150_000);
    assert.equal(parsePrizeAmount('5 lacs'), 500_000);
  });

  test('plural crore still works', () => {
    assert.equal(parsePrizeAmount('2 Crores'), 20_000_000);
  });

  test('the largest figure wins, not the first one in list order', () => {
    // `k` sat ahead of `m` in the multiplier list, so this read as 100,000.
    assert.equal(parsePrizeAmount('$1M + 100K in prizes'), 1_000_000);
  });

  test('"mil" is recognised', () => {
    assert.equal(parsePrizeAmount('1.5 mil'), 1_500_000);
  });
});

describe('toISO', () => {
  test('a bare date is pinned to UTC, not the server timezone', () => {
    // Parsed locally this became 2025-09-06T18:30Z on an IST host.
    assert.equal(toISO('SEP 7, 2025'), '2025-09-07T00:00:00.000Z');
  });

  test('a timestamp that already carries a zone is untouched', () => {
    assert.equal(toISO('2026-03-01T10:00:00Z'), '2026-03-01T10:00:00.000Z');
    assert.equal(toISO('2026-03-01T10:00:00+05:30'), '2026-03-01T04:30:00.000Z');
  });

  test('unparseable input is null rather than an invalid date', () => {
    assert.equal(toISO('not a date'), null);
    assert.equal(toISO(null), null);
  });
});

describe('mlhEventDates', () => {
  test('same-month range', () => {
    const d = mlhEventDates('HackMIT SEP 13 - 14 Cambridge, MA', '2027');
    assert.equal(d.startISO, '2026-09-13T00:00:00.000Z');
    assert.equal(d.endISO, '2026-09-14T00:00:00.000Z');
  });

  test('cross-month range is no longer dropped', () => {
    const d = mlhEventDates('HackNY OCT 31 - NOV 02 New York, NY', '2027');
    assert.equal(d.startISO, '2026-10-31T00:00:00.000Z');
    assert.equal(d.endISO, '2026-11-02T00:00:00.000Z');
  });

  test('single-day event is no longer dropped', () => {
    const d = mlhEventDates('OneDay JAN 24 Boston, MA', '2027');
    assert.equal(d.startISO, '2027-01-24T00:00:00.000Z');
    assert.equal(d.endISO, '2027-01-24T00:00:00.000Z');
  });

  test('a range crossing the new year lands in the right two years', () => {
    const d = mlhEventDates('NYE Hack DEC 30 - JAN 01 Austin, TX', '2027');
    assert.equal(d.startISO, '2026-12-30T00:00:00.000Z');
    assert.equal(d.endISO, '2027-01-01T00:00:00.000Z');
  });

  test('no date in the text returns null', () => {
    assert.equal(mlhEventDates('Coming soon — dates TBA', '2027'), null);
  });
});

describe('toISO on a zone-less ISO timestamp', () => {
  test('is read as UTC rather than the server timezone', () => {
    // "OCT 31, 2026" contains a literal T, so an includes('T') check for "is
    // this ISO" silently sent every October date down the local-parse path.
    assert.equal(toISO('2026-03-01T10:00:00'), '2026-03-01T10:00:00.000Z');
    assert.equal(toISO('OCT 31, 2026'), '2026-10-31T00:00:00.000Z');
  });
});

describe('isHackathonTitle', () => {
  // Unstop files real hackathons under `competitions`, alongside ~350 B-plans
  // and quizzes. `subtype` does not separate them, so the title has to.
  test('finds the hackathons hiding in the competitions feed', () => {
    for (const t of ['Hack Sphere', 'Software Ideathon I', 'CodeCraft Hackathon',
                     'BIO-ECONOMY HACKATHON 2026', 'The Golden Hour - A Voice AI Hackathon',
                     'Fixton Ideathon', 'Ideathon']) {
      assert.equal(isHackathonTitle(t), true, `expected "${t}" to be kept`);
    }
  });

  // A bare \w+athon matches every one of these, and none is a hackathon.
  test('rejects the other -athons and the plain competitions', () => {
    for (const t of ['Case-a-thon', 'Ai Filmathon', 'CADathon', 'Nirmiti CADathon',
                     'Brandathon', 'Chemi-Thone', 'Shark Tank', 'B-Plan', 'Robo War',
                     'Advertising Competition']) {
      assert.equal(isHackathonTitle(t), false, `expected "${t}" to be skipped`);
    }
  });
});

describe('mlhEventYear July boundary', () => {
  // Season 2027's earliest event is 2026-07-11, so July belongs to season - 1
  // like the other autumn months. Treating it as the season's own year dated
  // six finished hackathons a year into the future, where the expiry sweep
  // would not have reached them for ten months.
  test('July resolves to the previous calendar year', () => {
    assert.equal(mlhEventYear('jul', '2027'), '2026');
    assert.equal(mlhEventYear('JUL', '2027'), '2026');
  });

  test('the other months are unchanged', () => {
    assert.equal(mlhEventYear('sep', '2027'), '2026');
    assert.equal(mlhEventYear('jan', '2027'), '2027');
    assert.equal(mlhEventYear('jun', '2027'), '2027');
  });
});
