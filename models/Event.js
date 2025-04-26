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
   ticketsSold: { type: Number, default: 0 }, 
   image: { type: String, required: true },
   likes: { type: Number, default: 0 },
   comments: [{
     text: { type: String, required: true },
     user: { 
       type: Schema.Types.ObjectId, 
       ref: 'User',
       required: true 
     },
     createdAt: { type: Date, default: Date.now }
   }], // This was the missing closing bracket
   approved: { type: Boolean, default: false },
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;