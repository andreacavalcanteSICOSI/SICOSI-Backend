// pages/api/categories/index.js
import alternativesData from '../../../data/alternatives.json';

export default function handler(req, res) {
  try {
    res.status(200).json({
      success: true,
      categories: alternativesData.categories,
      metadata: alternativesData.metadata,
      totalCategories: Object.keys(alternativesData.categories).length
    });
  } catch (error) {
    console.error('❌ Categories error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}