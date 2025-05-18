const mongoose = require("mongoose");
const { Schema } = mongoose;

const ticketTypeSchema = new Schema({
  name: {
    type: String,
    required: true,
    enum: ['General', 'FanFest', 'VIP'] // Optional: restrict to these only
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
  approved: { type: Boolean, default: false },
  
  // New fields
  ticketTypes: [ticketTypeSchema], // Multiple ticket types
  salePhases: [salePhaseSchema]    // Phased ticket sales
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;