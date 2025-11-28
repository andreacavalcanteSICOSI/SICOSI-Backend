import alternativesData from '../data/alternatives.json';
import { identifyCategory } from '../pages/api/analyze-product';

const availableCategories = Object.keys((alternativesData as any).categories || {});

const testCases = [
  {
    name: 'Luxury Heels',
    input: {
      productName: 'Giuseppe Zanotti Slim 2.0 Black',
      pageTitle: 'Giuseppe Zanotti Slim 2.0 Black Heels - Amazon.com'
    },
    expected: 'textiles_clothing'
  },
  {
    name: 'Software',
    input: {
      productName: 'Adobe Photoshop 2024',
      pageTitle: 'Adobe Photoshop - Photo Editing Software'
    },
    expected: 'digital_products_software'
  },
  {
    name: 'Electronics',
    input: {
      productName: 'Apple Watch Series 9',
      pageTitle: 'Apple Watch - Smart Watch with Health Tracking'
    },
    expected: 'electronics'
  },
  {
    name: 'Portuguese Product',
    input: {
      productName: 'Tênis Nike Sustentável',
      pageTitle: 'Comprar Tênis Ecológico Online'
    },
    expected: 'textiles_clothing'
  }
];

async function runTests() {
  for (const test of testCases) {
    try {
      const result = await identifyCategory(
        test.input.productName,
        availableCategories,
        test.input.pageTitle,
        test.input.description || '',
      );
      const passed = result === test.expected;
      console.log(`${passed ? '✅' : '❌'} ${test.name}: ${result} (expected: ${test.expected})`);
    } catch (error) {
      console.log(`❌ ${test.name}: error ${(error as Error).message}`);
    }
  }
}

runTests();
