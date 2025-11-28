import assert from 'assert';
import { calculateSustainabilityScore, ProductFacts } from '../services/scoring-engine';

const sampleFacts: ProductFacts = {
  durability: { score: 80, evidence: ['Metal chassis', 'Warranty 5 years'] },
  repairability: { score: 60, evidence: ['Replacement parts available'] },
  recyclability: { score: 50, evidence: ['Uses recyclable plastic'] },
  energy_efficiency: { score: 70, evidence: ['Energy Star certified'] },
  materials: { score: 40, evidence: ['Some recycled content'] },
};

const { finalScore, breakdown, classification } = calculateSustainabilityScore(
  sampleFacts,
  'electronics',
);

assert.strictEqual(typeof finalScore, 'number');
assert.ok(finalScore > 0);
assert.ok(breakdown.durability);
assert.ok(classification.length > 0);

console.log('Scoring engine test passed:', { finalScore, classification });
