const deviceService = require('../services/deviceService');

const register = async (req, res) => {
  try {
    const { uuid, hardware_id } = req.body;
    const device = await deviceService.registerDevice(uuid, hardware_id);
    res.json(device);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const approve = async (req, res) => {
  try {
    const device = await deviceService.approveDevice(req.params.id);
    res.json(device);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const revoke = async (req, res) => {
  try {
    const device = await deviceService.revokeDevice(req.params.id);
    res.json(device);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { register, approve, revoke };