// Built-in exams split into timed sections (one timer per section instead of one for the whole set).
// ./<slug>.json is { "<pool name>": [[question, correctAnswer, distractor, distractor, distractor, 0, image?], ...] },
// where the optional image is a PNG file name in ./images/.
// Each pool is split across the 5 sets, `questions` per set, reusing as few questions as possible.
const path = require('node:path');

// VITEEE 2027 pattern: 100 MCQs in 2 hours, with a fixed time limit for each section. Aptitude and English
// share one 10-minute section (5 questions each). `parts` fills a section from more than one question pool;
// the "figures" pools hold questions with a diagram (images/), so every set gets some of them.
const VITEEE_SECTIONS = [
  { name: 'Mathematics', questions: 40, minutes: 50,
    parts: [{ pool: 'Mathematics', questions: 38 }, { pool: 'Mathematics figures', questions: 2 }] },
  { name: 'Physics', questions: 25, minutes: 30,
    parts: [{ pool: 'Physics', questions: 23 }, { pool: 'Physics figures', questions: 2 }] },
  { name: 'Chemistry', questions: 25, minutes: 30,
    parts: [{ pool: 'Chemistry', questions: 23 }, { pool: 'Chemistry figures', questions: 2 }] },
  { name: 'Aptitude & English', questions: 10, minutes: 10,
    parts: [{ pool: 'Aptitude', questions: 4 }, { pool: 'Aptitude figures', questions: 1 }, { pool: 'English', questions: 5 }] }
];

const META = [
  { slug: 'viteee', name: 'VITEEE – VIT Engineering Entrance Exam', short_label: 'VIT', color: '#1e40af', price_inr: 499,
    pass_pct: 50, sections: VITEEE_SECTIONS.map(({ name, questions, minutes }) => ({ name, questions, minutes })),
    seedSections: VITEEE_SECTIONS,
    description: 'Full-length VITEEE mock: Mathematics, Physics, Chemistry, Aptitude and English, each section with its own timer, as per the latest pattern.' }
];

const BANKS = META.map(m => ({
  ...m,
  duration_minutes: m.sections.reduce((t, s) => t + s.minutes, 0),
  sectionPools: require(path.join(__dirname, m.slug + '.json')),
  imageDir: path.join(__dirname, 'images')
}));

module.exports = { BANKS, META };
