const express = require("express");
const cors = require("cors");
require("dotenv").config();
const mongoose = require("mongoose");
const UserModel = require("./models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const Ticket = require("./models/Ticket");
const Event = require("./models/Event");

const app = express();

// Constants
const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = process.env.JWT_SECRET || "default_secret";

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({ credentials: true, origin: "http://localhost:3000" }));

// Ensure the 'uploads' directory exists
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Multer Configuration for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({ storage });

// Middleware to Authenticate User
const authenticateUser = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, jwtSecret, (err, userData) => {
    if (err) return res.status(401).json({ error: "Unauthorized" });
    req.user = userData;
    next();
  });
};

// Middleware to Check Admin Role
const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
};

// Middleware to Check Organizer or Admin Role
const isOrganizerOrAdmin = (req, res, next) => {
  if (req.user.role !== "admin" && req.user.role !== "organizer") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};
const canModifyEvent = async (req, res, next) => {
  const { role, id } = req.user; // from JWT
  const eventId = req.params.eventId;

  try {
    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Admins can modify any event
    if (role === "admin") {
      return next();
    }

    // Organizers can only modify their own events
    if (role === "organizer" && event.owner.toString() === id) {
      return next();
    }

    return res.status(403).json({ error: "You do not have permission to modify this event" });
  } catch (error) {
    console.error("Error checking event ownership:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// Automatically Create Admin Account if Not Exists
const createAdminIfNotExists = async () => {
  try {
    const adminExists = await UserModel.findOne({ email: "admin@mail.com" });
    if (!adminExists) {
      await UserModel.create({
        name: "Admin",
        email: "admin@mail.com",
        password: "admin", // Plain text; will be hashed by pre-save hook
        role: "admin",
      });
      console.log("Admin account created.");
    }
  } catch (error) {
    console.error("Error creating admin account:", error);
  }
};

createAdminIfNotExists();

// Routes

// Test Route
app.get("/test", (req, res) => {
  res.json("test ok");
});

// Register User
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const userDoc = await UserModel.create({
      name,
      email,
      password, // plain text password
      role: "user",
    });
    res.json(userDoc);
  } catch (e) {
    res.status(422).json(e);
  }
});

// Login User
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userDoc = await UserModel.findOne({ email });

    if (!userDoc) {
      return res.status(404).json({ error: "User not found" });
    }

    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (!passOk) {
      return res.status(401).json({ error: "Invalid password" });
    }

    jwt.sign(
      { email: userDoc.email, id: userDoc._id, role: userDoc.role },
      jwtSecret,
      {},
      (err, token) => {
        if (err) {
          return res.status(500).json({ error: "Failed to generate token" });
        }
        res.cookie("token", token).json({ ...userDoc.toObject(), token, role: userDoc.role });
      }
    );
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get Profile
app.get("/profile", authenticateUser, async (req, res) => {
  try {
    const { name, email, _id, role } = await UserModel.findById(req.user.id);
    res.json({ name, email, _id, role });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout
app.post("/logout", (req, res) => {
  res.cookie("token", "").json(true);
});


// Add comment to an event
app.post('/event/:eventId/comment', authenticateUser, async (req, res) => {
  const { eventId } = req.params;
  const { text } = req.body;
  const userId = req.user.id;

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const user = await UserModel.findById(userId).select('name email');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newComment = {
      text,
      user: userId,
      createdAt: new Date()
    };

    event.comments.push(newComment);
    await event.save();

    // Return the comment with user details
    res.status(201).json({
      _id: newComment._id,
      text: newComment.text,
      createdAt: newComment.createdAt,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// Get comments for an event
// Get comments for an event
app.get('/event/:eventId/comments', async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findById(eventId).populate({
      path: 'comments.user',
      select: 'name email' // Only select name and email
    });
    
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Map through comments to ensure consistent structure
    const formattedComments = event.comments.map(comment => ({
      _id: comment._id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: {
        _id: comment.user._id,
        name: comment.user.name,
        email: comment.user.email
      }
    }));

    res.status(200).json(formattedComments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});
// Create Organizer (Admin Only)
// Create Organizer (Admin Only)
app.post("/createOrganizer", authenticateUser, isAdmin, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User with this email already exists" });
    }
    const organizer = await UserModel.create({
      name,
      email,
      password, // Plain text; will be hashed by pre-save hook
      role: "organizer",
    });
    res.status(201).json({ message: "Organizer created successfully", organizer });
  } catch (error) {
    console.error("Error creating organizer:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get All Organizers (Admin Only)
app.get("/organizers", authenticateUser, isAdmin, async (req, res) => {
  try {
    const organizers = await UserModel.find({ role: "organizer" });
    res.status(200).json(organizers);
  } catch (error) {
    console.error("Error fetching organizers:", error);
    res.status(500).json({ error: "Failed to fetch organizers" });
  }
});

// Delete Organizer (Admin Only)
app.delete("/organizer/:id", authenticateUser, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const deletedOrganizer = await UserModel.findByIdAndDelete(id);
    if (!deletedOrganizer) {
      return res.status(404).json({ error: "Organizer not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting organizer:", error);
    res.status(500).json({ error: "Server error" });
  }
});



// Create Event (Admin or Organizer)
app.post("/createEvent", upload.single("image"), authenticateUser, isOrganizerOrAdmin, async (req, res) => {
  const { id, role } = req.user;
  const eventData = req.body;

  try {
    // Fetch the organizer's details from the database
    const organizer = await UserModel.findById(id);
    if (!organizer) {
      return res.status(404).json({ error: "Organizer not found" });
    }

    // Validate and set the owner field
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    eventData.owner = new mongoose.Types.ObjectId(id);

    // Set other event fields
    eventData.image = req.file ? `uploads/${req.file.filename}` : "";
    eventData.organizedBy = organizer.name;
    eventData.approved = role === "admin";

    // Create and save the event
    const newEvent = new Event(eventData);
    await newEvent.save();

    res.status(201).json(newEvent);
  } catch (err) {
    console.error("Error creating event:", err);
    res.status(500).json({ error: "Failed to save the event", details: err.message });
  }
});
// Approve Event (Admin Only)
app.put("/approveEvent/:eventId", authenticateUser, isAdmin, async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    event.approved = true;
    await event.save();

    res.status(200).json({ message: "Event approved successfully", event });
  } catch (error) {
    console.error("Error approving event:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get All Events (Public Access with Filtering)
app.get("/events", async (req, res) => {
  try {
    // Check if the user is authenticated
    const token = req.cookies.token;
    let query = {};

    if (token) {
      // If authenticated, verify the token and determine the user's role
      jwt.verify(token, jwtSecret, (err, userData) => {
        if (err) return; // Token is invalid; treat as unauthenticated

        // Authenticated user: Filter based on role
        if (userData.role === "user") {
          query.approved = true; // Regular users see only approved events
        }
        // Admins and organizers see all events (no filtering)
      });
    } else {
      // Unauthenticated user: Only show approved events
      query.approved = true;
    }

    // Fetch events based on the query
    const events = await Event.find(query);
    res.status(200).json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events from MongoDB" });
  }
});

// Get Event by ID
app.get("/event/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const event = await Event.findById(id);
    res.json(event);
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ error: "Failed to fetch event from MongoDB" });
  }
});

// Like Event (User Only)
app.post("/event/:eventId/like", authenticateUser, async (req, res) => {
  const eventId = req.params.eventId;

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    event.likes += 1;
    await event.save();
    res.json(event);
  } catch (error) {
    console.error("Error liking the event:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update Event (Admin Only)
app.put("/event/:eventId", upload.single("image"), authenticateUser, isAdmin, async (req, res) => {
  const eventId = req.params.eventId;
  const eventData = req.body;

  // Update the image path if a new image is uploaded
  eventData.image = req.file ? `uploads/${req.file.filename}` : eventData.image;

  try {
    const updatedEvent = await Event.findByIdAndUpdate(eventId, eventData, { new: true });
    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json(updatedEvent);
  } catch (error) {
    console.error("Error updating the event:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete Event (Admin Only)
app.delete("/event/:eventId", authenticateUser, isAdmin, async (req, res) => {
  const eventId = req.params.eventId;

  try {
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    if (!deletedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting the event:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Reject Event (Admin Only)
app.put("/rejectEvent/:eventId", authenticateUser, isAdmin, async (req, res) => {
  const { eventId } = req.params;
  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    event.approved = false;
    await event.save();
    res.status(200).json({ message: "Event rejected successfully", event });
  } catch (error) {
    console.error("Error rejecting event:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/event/:eventId", authenticateUser, canModifyEvent, async (req, res) => {
  const { eventId } = req.params;

  try {
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    if (!deletedEvent) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: "Failed to delete event" });
  }
});
app.put("/event/:eventId", upload.single("image"), authenticateUser, canModifyEvent, async (req, res) => {
  const { eventId } = req.params;
  const updates = req.body;

  try {
    const event = await Event.findById(eventId);
    if (req.file) {
      event.image = `uploads/${req.file.filename}`;
    }

    Object.assign(event, updates);
    await event.save();

    res.json(event);
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: "Failed to update event" });
  }
});

// Delete Event (Organizer or Admin who owns the event)
app.delete("/event/:eventId", authenticateUser, canModifyEvent, async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findByIdAndDelete(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get Events by Organizer ID
app.get("/events/organizer/:organizerId", authenticateUser, async (req, res) => {
  try {
    const events = await Event.find({ 
      owner: req.params.organizerId // No need for ObjectId conversion if using string in model
    });
    
    if (!events || events.length === 0) {
      return res.status(200).json([]); // Return empty array if no events found
    }
    
    res.status(200).json(events);
  } catch (error) {
    console.error("Error fetching organizer events:", error);
    res.status(500).json({ error: "Failed to fetch organizer events" });
  }
});
// Book a Ticket (User Only)
app.post("/bookTicket/:eventId", authenticateUser, async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  try {
    // Validate request body
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Atomically update the event
    const updatedEvent = await Event.findByIdAndUpdate(
      eventId,
      { $inc: { Quantity: -1, ticketsSold: 1 } },
      { new: true }
    );

    // Check if the event exists and has available tickets
    if (!updatedEvent || updatedEvent.Quantity < 0) {
      return res.status(400).json({ error: "No tickets available for this event" });
    }

    // Generate a unique QR code for the ticket
    let qrCode;
    try {
      const qrData = JSON.stringify({
        userId,
        eventId,
        bookingDate: new Date(),
      });
      qrCode = await QRCode.toDataURL(qrData);
    } catch (qrError) {
      console.error("Error generating QR code:", qrError);
      return res.status(500).json({ error: "Failed to generate QR code" });
    }

    // Create a new ticket record
    const newTicket = new Ticket({
      userid: userId,
      eventid: eventId,
      ticketDetails: {
        name,
        email,
        eventname: updatedEvent.title,
        eventdate: updatedEvent.eventDate,
        eventtime: updatedEvent.eventTime,
        ticketprice: updatedEvent.ticketPrice,
        qr: qrCode,
      },
      count: 1,
    });

    await newTicket.save();
    res.status(201).json({ message: "Ticket booked successfully", ticket: newTicket });
  } catch (error) {
    console.error("Error booking ticket:", error.message, error.stack);
    res.status(500).json({ error: "Server error" });
  }
});
// Get Tickets by User ID (User Only)
app.get("/tickets/user/:userId", authenticateUser, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userid: req.params.userId });
    res.json(tickets);
  } catch (error) {
    console.error("Error fetching user tickets:", error);
    res.status(500).json({ error: "Failed to fetch user tickets" });
  }
});
// Get Platform-Wide Analytics (Admin Only)
app.get("/admin/analytics", authenticateUser, isAdmin, async (req, res) => {
  try {
    const totalEvents = await Event.countDocuments();
    const totalTicketsSold = await Ticket.aggregate([
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    const totalEarnings = await Ticket.aggregate([
      { $group: { _id: null, total: { $sum: "$ticketDetails.ticketprice" } } },
    ]);

    res.status(200).json({
      totalEvents,
      totalTicketsSold: totalTicketsSold[0]?.total || 0,
      totalEarnings: totalEarnings[0]?.total || 0,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Get Organizer-Specific Analytics
app.get("/organizer/analytics", authenticateUser, async (req, res) => {
  const userId = req.user.id;
  try {
    const eventIds = await Event.find({ owner: userId }).distinct("_id");

    const totalEvents = eventIds.length;

    const tickets = await Ticket.find({ eventid: { $in: eventIds } });

    let totalTicketsSold = 0;
    let totalEarnings = 0;

    tickets.forEach(ticket => {
      totalTicketsSold += ticket.quantity || 1; // Assuming 1 ticket per document if quantity not available
      totalEarnings += (ticket.ticketDetails?.ticketprice || 0) * (ticket.quantity || 1);
    });

    res.status(200).json({
      totalEvents,
      totalTicketsSold,
      totalEarnings,
    });
  } catch (error) {
    console.error("Error fetching organizer analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Start the Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});