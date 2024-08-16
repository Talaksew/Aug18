require("dotenv/config");
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { error, log } = require("console");
const passportLocalMongoose = require('passport-local-mongoose');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');

//app declarations
const app = express();
app.use(cors({
  origin: 'http://localhost:3000', // Replace with your frontend URL
  credentials: true
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));


app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard on cat',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

//passport.js
app.use(passport.initialize());
app.use(passport.session());

//mongodb config
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/atnwebDB")
  .then(() => console.log("DB Connected"))
  .catch(err => console.log(err));

// Define user schema
const userSchema = new mongoose.Schema({
  googleID: { type: String, unique: true },
  username: { type: String,  unique: true }, //email
  role: { type: String, default: 'user', required: true },
  googleID_json: {type:JSON},
  profile: {
    firstName: String,
    lastName: String,
    age: Number,
    address: String,
    phone: String,
    avatar: String
  }
});
userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);
const User = new mongoose.model('User', userSchema);

// Define hotel schema
const hotelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  rating: { type: Number, min: 0, max: 5 },
  amenities: [{ type: String }],
  contact: {
    phone: String,
    email: String,
    website: String
  },
  created_at: { type: Date, default: Date.now }
});
const Hotel = mongoose.model('Hotel', hotelSchema);

// Define item schema
const itemSchema = new mongoose.Schema({
  name: { type: String },
  shortDetail: { type: String },
  detail: { type: String },
  latitude: { type: Number },
  longitude: { type: Number },
  address: { type: String },
  place_id: { type: String },
  hotels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' }],
  images: [{ type: String }],
  category: { type: String },
  specialDate: {
    day: { type: Number, required: true },
    month: { type: Number, required: true },
  },
  created_at: { type: Date, default: Date.now }
});

const Item = new mongoose.model('Item', itemSchema);

// Define reservation schema
const reservationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  reservationDate: { type: Date, required: true, default: Date.now },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled'],
    default: 'pending'
  },
  totalPrice: { type: Number, required: true },
  specialRequests: { type: String, default: '' },
  numberOfPersons: {
    personalOrFamily: {
      type: String,
      enum: ['personal', 'family'],
      default: 'personal'
    },
    family: { type: Number, default: 0 },
    adults: { type: Number, required: true },
    kids: { type: Number, default: 0 },
    husband: { type: Number, default: 0 },
    wife: { type: Number, default: 0 }
  }
});
const Reservation = new mongoose.model('Reservation', reservationSchema);

// Passport session setup
passport.use(User.createStrategy());

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

//passport google auth20
passport.use(new GoogleStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: "http://localhost:4000/auth/google/secrets",
  userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
},
async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('Google profile:', profile);

    let user = await User.findOne({ googleID: profile.id });

    if (!user) {
      user = new User({
        googleID: profile.id,
        username: profile.emails[0].value,
        googleID_json: profile._json,
        profile: {
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          avatar: profile.photos[0].value
        }
      });
      await user.save();
      console.log('User saved:', user);
    }

    return done(null, user);
  } catch (err) {
    console.error('Error in Passport strategy:', err);
    return done(err);
  }
}));

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Directory to save the images
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // File naming convention
  }
});
const upload = multer({ storage: storage });

// Login route
app.post('/login', passport.authenticate('local'), (req, res) => {
  res.send('Logged in successfully');
});

// Signup route
app.post('/signup', async (req, res) => {
  const { username, password, role, firstName, lastName, age, address, phone, avatar } = req.body;

  try {
   const newUser = new User({
     username,
     role,
     profile: { firstName, lastName, age, address, phone, avatar }
   });

    User.register(newUser, password, function (err, user) {
      if (err) {
        console.error(err);
        return res.status(500).send('Error1 signing up');
      }

      passport.authenticate('local')(req, res, function () {
        res.redirect('/Home');
      });
    });
 } catch (err) {
   console.error(err);
   res.status(500).send('Error2 signing up');
 }
});

// Route to logout
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect('/login');
  });
});

//google oauth
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile'] })
);

app.get('/auth/google/secrets', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });

// Add this to your existing backend code
app.get('/profile', (req, res) => {
  if (req.isAuthenticated()) {
    res.json(req.user); // Send the authenticated user's profile data
  } else {
    res.status(401).send('Unauthorized');
  }
});

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Middleware to check role
const hasRole = (role) => (req, res, next) => {
  if (req.isAuthenticated() && (req.user.role === "officer" || req.user.role===" admin")) {
    return next();
  }
  res.status(403).send('Access denied');
};

// Route for adding a new item
app.post('/add', upload.array('images', 7), isAuthenticated, async (req, res) => {
  try {
    const newItemData = {
      name: req.body.name,
      shortDetail: req.body.shortDetail,
      detail: req.body.detail,
      latitude: parseFloat(req.body.latitude),
      longitude: parseFloat(req.body.longitude),
      address: req.body.address,
      hotels: req.body.hotels, // Assuming hotels is an array of Hotel references
      category: req.body.category,
      specialDate: {
        day: parseInt(req.body.specialDay),
        month: parseInt(req.body.specialMonth)
      },
      images: []
    };

    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        newItemData.images.push(`/uploads/${file.filename}`); // Store the file path
      });
    }

    const newItem = await Item.create(newItemData);
    res.send('Data inserted successfully');
  } catch (error) {
    console.error('Error inserting data:', error);
    res.status(500).send('Error inserting data');
  }
});

// Route for adding a new hotel
app.post('/addHotel', isAuthenticated, async (req, res) => {
  try {
    const newHotelData = {
      name: req.body.name,
      address: req.body.address,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      amenities: req.body.amenities,
      rating: req.body.rating,
      phone: req.body.phone,
      email: req.body.email,
      website: req.body.website
    };

    const newHotel = await Hotel.create(newHotelData);
    res.send('Data inserted successfully');
  } catch (error) {
    console.error('Error inserting data:', error);
    res.status(500).send('Error inserting data');
  }
});

// Route for recording a new request to Reserv
app.post('/addRequest', isAuthenticated, async (req, res) => {
  try {
    const newReservationData = {
       user: req.body.user,
       item: req.body.website,
       reservationDate: req.body.website,
       startDate: req.body.startDate,
       endDate: req.body.endDate,
       status:  'pending',
       totalPrice: 0,
       specialRequests: req.body.specialRequests,
       numberOfPersons: req.body.numberOfPersons,
       personalOrFamily: 'personal',
       family:  0 ,
       adults: 0,
       kids: 0,
       husband:  0 ,
       wife:0 
    };

    const newReservation = await Reservation.create(newReservationData);
    res.send('Data inserted successfully');
  } catch (error) {
    console.error('Error inserting data:', error);
    res.status(500).send('Error inserting data');
  }
});

// Route to fetch all items
app.get('/items', async (req, res) => {
  try {
    const items = await Item.find(); // Fetch all items
    res.json(items); // Send items as JSON response
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).send('Error fetching items');
  }
});

// Route to fetch selected item
app.get('/viewDetail', async (req, res) => {
  const selectedItem_id = req.query.item_id;
  
  try {
    const item = await Item.findById(selectedItem_id); // Find item by ID
    if (item) {
      res.json(item); // Send the item as JSON response
    } else {
      res.status(404).send('Item not found');
    }
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).send('Error fetching item');
  }
});

// Route to fetch selected item details
app.get('/viewDetail/:item_id', async (req, res) => {
  const item_id = req.params.item_id;
  try {
    const item = await Item.findById(item_id);
    if (!item) {
      return res.status(404).send('Item not found');
    }
    res.json(item);
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).send('Error fetching item');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
