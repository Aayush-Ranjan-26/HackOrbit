import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// scraper.js -> lib/supabase.js throws unless these are set; no network call is
// made at import time (createClient does not connect eagerly), so any truthy
// values are fine here.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';

const { parsePrizeAmount, mlhEventYear, mlhSeasons, stripHTML, isGenericSkill } = await import('../src/jobs/scraper.js');

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
