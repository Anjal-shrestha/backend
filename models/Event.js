const mongoose = require("mongoose");
const { Schema } = mongoose;

// Ticket Type Schema
const ticketTypeSchema = new Schema({
  name: {
    type: String,
    required: true,
    enum: ['General', 'FanFest', 'VIP']
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  sold: {
    type: Number,
    default: 0
  }
});

// Sale Phase Schema
const salePhaseSchema = new Schema({
  phase: {
    type: String,
    required: true,
    enum: ['early_bird', 'general_sale', 'final_phase']
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  discountPercent: {
    type: Number,
    min: 0,
    max: 100
  }
});

// Event Schema
const eventSchema = new Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  organizedBy: { type: String, required: true },
  eventDate: { type: Date, required: true },
  eventTime: { type: String, required: true },
  location: { type: String, required: true },
  image: { type: String, required: true },
  likes: { type: Number, default: 0 },
  comments: [{
    text: { type: String, required: true },
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    createdAt: { type: Date, default: Date.now }
  }],
  
  // ✅ Use status instead of approved
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },

  // New fields
  ticketTypes: [ticketTypeSchema], // Multiple ticket types
  salePhases: [salePhaseSchema]    // Phased ticket sales
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;