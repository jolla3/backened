const Device = require('../models/device');
const Cooperative = require('../models/cooperative');

const registerDevice = async (deviceData) => {
  const { 
    deviceId, 
    name, 
    location, 
    type, 
    adminId, 
    cooperativeId, 
    uuid, 
    hardware_id 
  } = deviceData;
  
  // ✅ Validate cooperative exists
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ FIXED: Map to EXACT schema fields
  const device = new Device({
    // ✅ REQUIRED: uuid (use deviceId if no uuid)
    uuid: uuid || deviceId,
    
    // ✅ OPTIONAL: hardware_id
    hardware_id: hardware_id,
    
    // ✅ CUSTOM fields (not in schema but ok as extras)
    name,
    location,
    type,
    
    // ✅ REQUIRED: cooperativeId & created_by (use adminId)
    cooperativeId,
    created_by: adminId || cooperativeId, // fallback to coopId if no adminId
    
    // ✅ Schema defaults handle the rest:
    // approved: false
    // revoked: false  
    // last_seen: Date.now()
    // created_at: Date.now()
  });
  
  return await device.save();
};

const approveDevice = async (deviceId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ FIXED: Update schema fields (approved: true)
  const device = await Device.findOneAndUpdate(
    { _id: deviceId, cooperativeId },
    { approved: true }, // ✅ Schema field
    { new: true }
  );
  
  if (!device) throw new Error('Device not found');
  return device;
};

const revokeDevice = async (deviceId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ FIXED: Update schema fields (revoked: true)
  const device = await Device.findOneAndUpdate(
    { _id: deviceId, cooperativeId },
    { 
      revoked: true,
      revoked_timestamp: new Date()
    }, // ✅ Schema fields
    { new: true }
  );
  
  if (!device) throw new Error('Device not found');
  return device;
};

module.exports = { registerDevice, approveDevice, revokeDevice };