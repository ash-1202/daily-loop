import { describe, expect, it } from 'vitest';
import { findDatasetProblems, type ScamsFile, type TermsFile } from '@daily-loop/shared';
import { loadAllDatasets } from '../src/seed/seed';

describe('dataset files', () => {
  it('all pass schema and rule checks', async () => {
    const datasets = await loadAllDatasets();
    expect(datasets.map((d) => d.id)).toEqual(['terms', 'scams', 'badges']);
  });

  it('have enough cards for daily challenges (2 terms + 2 scams a day, no repeats for 2 weeks)', async () => {
    const datasets = await loadAllDatasets();
    const count = (id: string) => datasets.find((d) => d.id === id)!.file.items.length;
    expect(count('terms')).toBeGreaterThanOrEqual(28);
    expect(count('scams')).toBeGreaterThanOrEqual(28);
  });

  it('mix scams and safe messages so "always scam" is not a winning strategy', async () => {
    const scams = (await loadAllDatasets()).find((d) => d.id === 'scams')!.file as ScamsFile;
    const safeShare = scams.items.filter((i) => !i.is_scam).length / scams.items.length;
    expect(safeShare).toBeGreaterThanOrEqual(0.25);
  });
});

describe('findDatasetProblems', () => {
  const term = {
    id: 'term_0001',
    question: 'What is a SIP?',
    answer: 'Regular investing',
    distractors: ['A loan', 'A tax'],
    explanation: 'x',
    icon: '📅',
    difficulty: 1,
  };
  const termsFile = (items: TermsFile['items']): TermsFile => ({
    dataset: 'terms',
    name: 'Test',
    version: 1,
    items,
  });

  it('accepts a valid file', () => {
    expect(findDatasetProblems(termsFile([term]))).toEqual([]);
  });

  it('flags duplicate ids', () => {
    const problems = findDatasetProblems(
      termsFile([term, { ...term, question: 'Another question' }]),
    );
    expect(problems).toContain('term_0001: duplicate id');
  });

  it('flags a distractor that equals the answer (ignoring case and spaces)', () => {
    const problems = findDatasetProblems(
      termsFile([{ ...term, distractors: [' regular INVESTING ', 'A tax'] }]),
    );
    expect(problems).toContain('term_0001: answer and distractors must all be different');
  });

  it('flags a scam without red flags and a safe message with red flags', () => {
    const file: ScamsFile = {
      dataset: 'scams',
      name: 'Test',
      version: 1,
      items: [
        {
          id: 'scam_0001',
          message: 'm',
          is_scam: true,
          red_flags: [],
          explanation: 'e',
          difficulty: 1,
        },
        {
          id: 'scam_0002',
          message: 'm',
          is_scam: false,
          red_flags: ['x'],
          explanation: 'e',
          difficulty: 1,
        },
      ],
    };
    expect(findDatasetProblems(file)).toEqual([
      'scam_0001: a scam needs at least one red flag',
      'scam_0002: a safe message should have no red flags',
    ]);
  });
});
