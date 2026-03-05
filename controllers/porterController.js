const porterService = require('../services/porterService');
const User = require('../models/user');

const getPerformance = async (req, res) => {
  try {
    const performance = await porterService.getPerformance(req.params.id);
    res.json(performance);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createPorter = async (req, res) => {
  try {
    const { name, email, password, zones } = req.body;
    
    const user = await User.create({
      email,
      password,
      name,
      role: 'porter'
    });

    const porter = await porterService.createPorter({
      name,
      zones,
      user_id: user._id
    });

    res.status(201).json({ user, porter });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getPerformance, createPorter };