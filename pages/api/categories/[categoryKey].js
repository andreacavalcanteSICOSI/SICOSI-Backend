// pages/api/categories/[categoryKey].js
import alternativesData from '../../../data/alternatives.json';

export default function handler(req, res) {
  try {
    const { categoryKey } = req.query;
    const categoryData = alternativesData.categories[categoryKey];

    if (!categoryData) {
      return res.status(404).json({
        success: false,
        error: `Category not found: ${categoryKey}`
      });
    }

    res.status(200).json({
      success: true,
      category: categoryKey,
      data: categoryData
    });
  } catch (error) {
    console.error('❌ Category error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}