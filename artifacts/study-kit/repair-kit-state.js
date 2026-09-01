// Defensive client-side repair for older/incomplete kits.
// This runs before React so a kit with an empty quiz or overview cannot crash the study workspace.
(() => {
  const STORAGE = 'lecture-study-kits';
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return;
    const kits = JSON.parse(raw);
    if (!Array.isArray(kits)) return;

    const repaired = kits.map((kit) => {
      const next = { ...kit };
      next.chapters = Array.isArray(next.chapters) ? next.chapters : [];
      next.reviewPlan = Array.isArray(next.reviewPlan) ? next.reviewPlan : [];
      next.flashcards = Array.isArray(next.flashcards) ? next.flashcards : [];
      next.questions = Array.isArray(next.questions) ? next.questions : [];
      next.materials = Array.isArray(next.materials) ? next.materials : [];

      if (!next.overview || typeof next.overview !== 'string') {
        const source = next.materials.map((m) => m?.text || '').filter(Boolean).join(' ');
        next.overview = source
          ? source.slice(0, 500).trim() + (source.length > 500 ? '…' : '')
          : 'A focused study guide built from your learning material.';
      }

      if (next.chapters.length === 0) {
        next.chapters = [{
          id: 'main',
          title: next.title || 'Main topic',
          summary: next.overview,
          keyPoints: next.flashcards.slice(0, 4).map((card) => card.front),
          objective: 'Explain the main ideas in your own words.'
        }];
      }

      // PracticeExam expects at least one question. Build a safe question from flashcards
      // when the kit was generated with flashcards but no quiz.
      if (next.questions.length === 0 && next.flashcards.length > 0) {
        const card = next.flashcards[0];
        const distractors = next.flashcards.slice(1, 4).map((item) => item.back).filter(Boolean);
        const options = [card.back, ...distractors];
        while (options.length < 2) options.push('Not covered by this study material.');
        next.questions = [{
          id: 'generated-q1',
          chapterId: card.chapterId || next.chapters[0].id,
          prompt: card.front,
          options,
          answer: 0,
          explanation: card.back,
          difficulty: 'Core'
        }];
      }

      return next;
    });

    localStorage.setItem(STORAGE, JSON.stringify(repaired));
  } catch {
    // The React app has its own fallbacks; never block startup because of repair code.
  }
})();
