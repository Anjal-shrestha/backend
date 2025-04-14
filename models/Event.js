// models/Event.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const eventSchema = new Schema({
   owner: { type: String, required: true },
   title: { type: String, required: true },
   description: { type: String, required: true },
   organizedBy: { type: String, required: true },
   eventDate: { type: Date, required: true },
   eventTime: { type: String, required: true },
   location: { type: String, required: true },
   Participants: { type: Number, default: 0 },
   Count: { type: Number, default: 0 },
   Income: { type: Number, default: 0 },
   ticketPrice: { type: Number, required: true },
   Quantity: { type: Number, required: true },
   image: { type: String, required: true },
   likes: { type: Number, default: 0 },
   Comment: [String],
   approved: { type: Boolean, default: false }, // Add an approved field
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;