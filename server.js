const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const moment = require("moment");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { body, param, query, validationResult } = require("express-validator");
const { User, Tweet, Comment } = require("./models/File");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      "https://varuns-twitter-clone.vercel.app",
      "http://localhost:3000",
    ],
  })
); // Restrict CORS to trusted origins
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("build"));
app.use("/images", express.static("images"));
app.use("./tweetImages", express.static("tweetImages"));

// Rate Limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // Limit each IP to 100 requests per windowMs
//   message: "Too many requests from this IP, please try again later",
// });
// app.use(limiter);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, (err) => {
  if (err) console.error("MongoDB connection error:", err);
  else console.log("MongoDB is connected");
});

// Helper Function: Validate JWT
const validateToken = (req, res, next) => {
  const token = req.headers["x-access-token"];
  if (!token) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.user = decoded; // Attach decoded token to the request object
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ status: "error", message: "Invalid or expired token" });
  }
};

// Helper Function: Handle Validation Errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: "error", errors: errors.array() });
  }
  next();
};

// Sign In
app.post(
  "/",
  // validateToken,
  // [
  //   body("username").isAlphanumeric().withMessage("Invalid username"),
  //   body("password")
  //     .isLength({ min: 6 })
  //     .withMessage("Password must be at least 6 characters long"),
  // ],
  // handleValidationErrors,
  async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await User.findOne({ username });
      if (!user) {
        return res
          .status(401)
          .json({ status: "error", message: "Invalid login credentials" });
      }

      const isCorrect = await bcrypt.compare(password, user.password);
      if (!isCorrect) {
        return res
          .status(401)
          .json({ status: "error", message: "Invalid login credentials" });
      }

      const payload = { id: user._id, username: user.username };
      const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
        expiresIn: "1d",
      });

      return res.status(200).json({ status: "ok", token });
    } catch (err) {
      console.error("Error during login:", err);
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error" });
    }
  }
);

// Feed
app.get(
  "/feed",
  validateToken,
  // [query("t").optional().isInt({ min: 0 }).withMessage("Invalid skip value")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const tweetsToSkip = parseInt(req.query.t) || 0;
      const username = req.user.username;

      const tweets = await Tweet.find({ isRetweeted: false })
        .populate("postedBy", "username avatar")
        .populate("comments")
        .sort({ createdAt: -1 })
        .skip(tweetsToSkip)
        .limit(20);

      // Add like/retweet status for the active user
      tweets.forEach((tweet) => {
        tweet.likeTweetBtn = tweet.likes.includes(username)
          ? "deeppink"
          : "black";
        tweet.retweetBtn = tweet.retweets.includes(username)
          ? "green"
          : "black";

        tweet.comments.forEach((comment) => {
          comment.likeCommentBtn = comment.likes.includes(username)
            ? "deeppink"
            : "black";
        });
      });

      return res
        .status(200)
        .json({ status: "ok", tweets, activeUser: username });
    } catch (err) {
      console.error("Error fetching feed:", err);
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error" });
    }
  }
);

//sign up
app.post(
  "/signup",
  [
    // Validation rules
    body("username")
      .isAlphanumeric()
      .withMessage("Username must contain only letters and numbers")
      .isLength({ min: 3, max: 20 })
      .withMessage("Username must be between 3 and 20 characters long"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
  ],
  async (req, res) => {
    try {
      // Handle validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res
          .status(400)
          .json({ status: "error", errors: errors.array() });
      }

      const user = req.body;

      // Check if the username is already taken
      const takenUsername = await User.findOne({ username: user.username });
      if (takenUsername) {
        return res
          .status(400)
          .json({ status: "error", error: "Username is already taken" });
      }

      // Hash the password
      user.password = await bcrypt.hash(req.body.password, 10);

      // Create a new user
      const dbUser = new User({
        username: user.username.toLowerCase(),
        password: user.password,
        avatar: "initial-avatar.png",
      });

      await dbUser.save();

      return res
        .status(201)
        .json({ status: "ok", message: "User created successfully" });
    } catch (err) {
      console.error("Error during signup:", err);
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error" });
    }
  }
);

//populate comments of a particular tweet
app.get("/feed/comments/:tweetId", async (req, res) => {
  try {
    // Find the tweet by its unique identifier
    const tweet = await Tweet.findOne({ postedTweetTime: req.params.tweetId });
    if (!tweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Tweet not found" });
    }

    // Determine the original tweet (if the current tweet is a retweet)
    const originalTweetId = tweet.retweetedFrom || tweet._id;

    // Find the original tweet and populate the comments
    const originalTweet = await Tweet.findById(originalTweetId)
      .populate("postedBy", "username avatar")
      .populate({
        path: "comments",
        populate: {
          path: "postedBy",
          select: "username avatar",
        },
      });

    if (!originalTweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Original tweet not found" });
    }

    // Return the comments of the original tweet
    return res.status(200).json({
      status: "ok",
      tweet: { comments: originalTweet.comments },
    });
  } catch (err) {
    console.error("Error fetching comments:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

//compose tweet
app.post("/feed", validateToken, async (req, res) => {
  try {
    const info = req.body;
    const tweetInfo = req.body.tweet;

    // Create a new tweet
    const newTweet = await Tweet.create({
      content: tweetInfo.content,
      retweets: [],
      tag: tweetInfo.tag,
      postedTweetTime: moment().format("MMMM Do YYYY, h:mm:ss a"),
      image: info.image || null, // Set image to null if not provided
    });

    // Find the user who posted the tweet
    const user = await User.findOne({ username: req.user.username }); // Use username from the validated token
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // Associate the tweet with the user
    newTweet.postedBy = user._id;
    await newTweet.save();

    user.tweets.unshift(newTweet._id);
    await user.save();

    return res.status(200).json({ status: "ok", tweet: newTweet });
  } catch (err) {
    console.error("Error composing tweet:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});
//compose comment
app.post("/feed/comment/:tweetId", validateToken, async (req, res) => {
  try {
    // Create a new comment
    const newComment = await Comment.create({
      content: req.body.content,
      postedCommentTime: moment().format("MMMM Do YYYY, h:mm:ss a"),
      likes: [],
      likeCommentBtn: "black",
    });

    // Find the tweet by its unique identifier
    const tweet = await Tweet.findOne({ postedTweetTime: req.params.tweetId });
    if (!tweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Tweet not found" });
    }

    // Determine the original tweet (if the current tweet is a retweet)
    const originalTweetId = tweet.retweetedFrom || tweet._id;

    // Find the original tweet
    const originalTweet = await Tweet.findById(originalTweetId);
    if (!originalTweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Original tweet not found" });
    }

    // Find the user who posted the comment
    const user = await User.findOne({ username: req.user.username });
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // Associate the comment with the user
    newComment.postedBy = user._id;
    await newComment.save();

    // Add the comment to the original tweet
    originalTweet.comments.unshift(newComment._id);
    await originalTweet.save();

    // Propagate the updated comments to all retweets of the original tweet
    await Tweet.updateMany(
      { $or: [{ _id: originalTweetId }, { retweetedFrom: originalTweetId }] },
      { comments: originalTweet.comments }
    );

    // Populate the comment with user details before returning
    const populatedComment = await Comment.findById(newComment._id).populate(
      "postedBy",
      "username avatar"
    );

    // Return the newly created comment and updated comment count
    return res.status(200).json({
      status: "ok",
      comment: populatedComment,
      commentCount: originalTweet.comments.length,
    });
  } catch (err) {
    console.error("Error adding comment:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

//retweet
app.post(
  "/post/:userName/retweet/:tweetId",
  validateToken,
  async (req, res) => {
    try {
      // Find the tweet by its unique identifier
      const tweet = await Tweet.findOne({
        postedTweetTime: req.params.tweetId,
      });

      if (!tweet) {
        return res
          .status(404)
          .json({ status: "error", message: "Tweet not found" });
      }

      // Determine if the tweet is an original or a retweet
      const originalTweetId = tweet.retweetedFrom || tweet._id;

      // Check if the user has already retweeted the original tweet
      const userIndex = tweet.retweets.indexOf(req.params.userName);

      if (userIndex === -1) {
        // RETWEET: Only allowed if the tweet is an original tweet
        if (tweet.isRetweeted) {
          return res.status(400).json({
            status: "error",
            message: "Cannot retweet a retweeted tweet",
          });
        }

        // Create a new retweet
        const newTweet = await Tweet.create({
          content: tweet.content,
          postedBy: tweet.postedBy,
          likes: tweet.likes,
          retweets: [...tweet.retweets, req.params.userName],
          tag: tweet.tag,
          likeTweetBtn: tweet.likeTweetBtn,
          retweetBtn: "green", // Change the retweet button color
          image: tweet.image,
          comments: tweet.comments,
          isEdited: tweet.isEdited,
          postedTweetTime: moment().format("MMMM Do YYYY, h:mm:ss a"),
          retweetedFrom: originalTweetId, // Reference to the original tweet
          isRetweeted: true,
        });

        // Add the new retweet to the user's tweets
        const user = await User.findOne({ username: req.params.userName });
        if (user) {
          user.tweets.unshift(newTweet._id);
          await user.save();
        }

        // Update the original tweet's retweets
        await Tweet.findByIdAndUpdate(originalTweetId, {
          $push: { retweets: req.params.userName },
        });

        return res.status(200).json({
          status: "ok",
          retweetCount: tweet.retweets.length + 1,
          retweetBtn: "green",
        });
      } else {
        // UN-RETWEET: Allowed for both original and retweeted tweets
        const retweetedTweet = await Tweet.findOneAndDelete({
          retweetedFrom: originalTweetId,
          postedBy: req.user.id,
        });

        if (retweetedTweet) {
          // Remove the user from the original tweet's retweets
          await Tweet.findByIdAndUpdate(originalTweetId, {
            $pull: { retweets: req.params.userName },
          });

          // Remove the retweet from the user's tweets
          const user = await User.findOne({ username: req.params.userName });
          if (user) {
            user.tweets = user.tweets.filter(
              (tweetId) => tweetId.toString() !== retweetedTweet._id.toString()
            );
            await user.save();
          }

          return res.status(200).json({
            status: "ok",
            retweetCount: tweet.retweets.length - 1,
            retweetBtn: "black",
          });
        }
      }
    } catch (err) {
      console.error("Error handling retweet:", err);
      return res
        .status(500)
        .json({ status: "error", message: "Internal server error" });
    }
  }
);

// Retrieve a single tweet by tweetId
app.get("/tweet/:tweetId", async (req, res) => {
  try {
    const token = req.headers["x-access-token"];
    if (!token) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    } catch (err) {
      return res
        .status(401)
        .json({ status: "error", message: "Invalid or expired token" });
    }

    const username = decoded.username;
    const user = await User.findOne({ username: username });
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    const tweet = await Tweet.findOne({ postedTweetTime: req.params.tweetId })
      .populate("postedBy", "username avatar")
      .populate({
        path: "comments",
        populate: {
          path: "postedBy",
          select: "username avatar",
        },
      });

    if (!tweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Tweet not found" });
    }

    return res.status(200).json({ status: "ok", tweet, activeUser: user });
  } catch (err) {
    console.error("Error retrieving tweet:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

//like tweet
app.route("/post/:userName/like/:tweetId").post(async (req, res) => {
  try {
    // Find the tweet by its unique identifier
    const tweet = await Tweet.findOne({ postedTweetTime: req.params.tweetId });

    if (!tweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Tweet not found" });
    }

    // Check if the user has already liked the tweet
    const userIndex = tweet.likes.indexOf(req.params.userName);

    if (userIndex === -1) {
      // User has not liked the tweet, so add the like
      tweet.likes.push(req.params.userName);
      tweet.likeTweetBtn = "deeppink";
    } else {
      // User has already liked the tweet, so remove the like
      tweet.likes.splice(userIndex, 1);
      tweet.likeTweetBtn = "black";
    }

    // Save the updated tweet
    await tweet.save();

    // Propagate the like to the original tweet and all its retweets
    const tweetIdToUpdate = tweet.retweetedFrom || tweet._id; // Use original tweet ID if it's a retweet
    await Tweet.updateMany(
      { $or: [{ _id: tweetIdToUpdate }, { retweetedFrom: tweetIdToUpdate }] },
      { likes: tweet.likes }
    );

    // Return the updated like count and button color to the frontend
    return res.status(200).json({
      status: "ok",
      likeCount: tweet.likes.length,
      likeTweetBtn: tweet.likeTweetBtn,
    });
  } catch (err) {
    console.error("Error updating like:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

//like comment
app.route("/comment/:userName/like/:commentId").post(async (req, res) => {
  try {
    // Find the comment by its unique identifier
    const comment = await Comment.findOne({
      postedCommentTime: req.params.commentId,
    });

    if (!comment) {
      return res
        .status(404)
        .json({ status: "error", message: "Comment not found" });
    }

    // Check if the user has already liked the comment
    const userIndex = comment.likes.indexOf(req.params.userName);

    if (userIndex === -1) {
      // User has not liked the comment, so add the like
      comment.likes.push(req.params.userName);
      comment.likeCommentBtn = "deeppink";
    } else {
      // User has already liked the comment, so remove the like
      comment.likes.splice(userIndex, 1);
      comment.likeCommentBtn = "black";
    }

    // Save the updated comment
    await comment.save();

    // Return the updated like count and button color to the frontend
    return res.status(200).json({
      status: "ok",
      btnColor: comment.likeCommentBtn,
      likeCount: comment.likes.length,
    });
  } catch (err) {
    console.error("Error updating comment like:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

// Delete tweet
app.route("/deleteTweet/:tweetId").post(validateToken, async (req, res) => {
  try {
    // Find the tweet by its unique identifier
    const tweet = await Tweet.findOne({ postedTweetTime: req.params.tweetId });
    if (!tweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Tweet not found" });
    }

    // Check if the authenticated user is the owner of the tweet
    if (tweet.postedBy.toString() !== req.user.id) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized to delete this tweet",
      });
    }

    // Delete the tweet
    await Tweet.findByIdAndDelete(tweet._id);

    // Optionally, remove the tweet reference from the user's tweets array
    const user = await User.findById(req.user.id);
    if (user) {
      user.tweets = user.tweets.filter(
        (tweetId) => tweetId.toString() !== tweet._id.toString()
      );
      await user.save();
    }

    return res
      .status(200)
      .json({ status: "ok", message: "Tweet deleted successfully" });
  } catch (err) {
    console.error("Error deleting tweet:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

// Delete comment
app.route("/comment/delete/:commentId").post(async (req, res) => {
  try {
    // Find and delete the comment by its unique identifier
    const deletedComment = await Comment.findOneAndDelete({
      postedCommentTime: req.params.commentId,
    });

    if (!deletedComment) {
      return res
        .status(404)
        .json({ status: "error", message: "Comment not found" });
    }

    // Remove the comment from the original tweet and all its retweets
    await Tweet.updateMany(
      { comments: req.params.commentId },
      { $pull: { comments: req.params.commentId } }
    );

    return res
      .status(200)
      .json({ status: "ok", message: "Comment deleted successfully" });
  } catch (err) {
    console.error("Error deleting comment:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

// Edit tweet
app.route("/editTweet/:tweetId").post(validateToken, async (req, res) => {
  try {
    const { content } = req.body;

    // Validate input
    if (!content || content.trim() === "") {
      return res
        .status(400)
        .json({ status: "error", message: "Content cannot be empty" });
    }

    // Find the tweet by its unique identifier
    const tweet = await Tweet.findOne({ postedTweetTime: req.params.tweetId });
    if (!tweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Tweet not found" });
    }

    // Determine the original tweet (if the current tweet is a retweet)
    const originalTweetId = tweet.retweetedFrom || tweet._id;

    // Find the original tweet
    const originalTweet = await Tweet.findById(originalTweetId);
    if (!originalTweet) {
      return res
        .status(404)
        .json({ status: "error", message: "Original tweet not found" });
    }

    // Check if the authenticated user is the owner of the original tweet
    if (originalTweet.postedBy.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ status: "error", message: "Unauthorized to edit this tweet" });
    }

    // Update the original tweet content and mark it as edited
    originalTweet.content = content;
    originalTweet.isEdited = true;
    await originalTweet.save();

    // Propagate the updated content to all retweets of the original tweet
    await Tweet.updateMany(
      { retweetedFrom: originalTweetId },
      { content: originalTweet.content, isEdited: true }
    );

    // Fetch the updated original tweet from the database
    const updatedTweet = await Tweet.findById(originalTweetId).populate(
      "postedBy",
      "username avatar"
    );

    return res.status(200).json({
      status: "ok",
      message: "Tweet updated successfully",
      tweet: updatedTweet,
    });
  } catch (err) {
    console.error("Error editing tweet:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});
// Edit comment
app.route("/comment/edit/:commentId").post(async (req, res) => {
  try {
    const { content } = req.body;

    // Validate input
    if (!content || content.trim() === "") {
      return res
        .status(400)
        .json({ status: "error", message: "Content cannot be empty" });
    }

    // Find the comment by its unique identifier
    const comment = await Comment.findOne({
      postedCommentTime: req.params.commentId,
    });
    if (!comment) {
      return res
        .status(404)
        .json({ status: "error", message: "Comment not found" });
    }

    // Update the comment content and mark it as edited
    comment.content = content;
    comment.isEdited = true;
    await comment.save();

    return res
      .status(200)
      .json({ status: "ok", message: "Comment updated successfully" });
  } catch (err) {
    console.error("Error editing comment:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

app.post("/avatar/:userName", (req, res) => {
  User.findOne({ username: req.params.userName }, (err, user) => {
    if (!err) {
      user.avatar = req.body.avatar;
      if (user.avatar) {
        user.save();
        return res.json({ status: "ok", avatar: req.body.avatar });
      }
    } else return res.json({ status: "error", error: "Please choose again" });
  });
});

//user profile
app.get("/profile/:userName", validateToken, async (req, res) => {
  try {
    const tweetsToSkip = parseInt(req.query.t) || 0; // Pagination: Number of tweets to skip
    const tweetsLimit = 20; // Pagination: Number of tweets to fetch per request

    // Find the user whose profile is being requested
    const profileUser = await User.findOne({
      username: req.params.userName,
    }).populate({
      path: "tweets",
      options: {
        sort: { createdAt: -1 },
        skip: tweetsToSkip,
        limit: tweetsLimit,
      }, // Pagination options
      populate: [
        { path: "postedBy", select: "username avatar" },
        {
          path: "comments",
          populate: { path: "postedBy", select: "username avatar" },
        },
      ],
    });

    if (!profileUser) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // Check if the active user follows the profile user
    const isFollowing = profileUser.followers.includes(req.user.username);
    const followBtn = isFollowing ? "Following" : "Follow";

    // Add like/retweet status for the active user
    profileUser.tweets.forEach((tweet) => {
      tweet.likeTweetBtn = tweet.likes.includes(req.user.username)
        ? "deeppink"
        : "black";
      tweet.retweetBtn = tweet.retweets.includes(req.user.username)
        ? "green"
        : "black";

      tweet.comments.forEach((comment) => {
        comment.likeCommentBtn = comment.likes.includes(req.user.username)
          ? "deeppink"
          : "black";
      });
    });

    // Return the profile data and paginated tweets
    return res.status(200).json({
      status: "ok",
      tweets: profileUser.tweets,
      followers: profileUser.followers.length,
      followBtn: followBtn,
      activeUser: req.user.username,
      avatar: profileUser.avatar,
      bio: profileUser.bio,
      banner: profileUser.banner,
    });
  } catch (err) {
    console.error("Error fetching profile:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

//follow
//userName= active user
//user= profile
app.route("/user/:user/follow/:userName").post((req, res) => {
  User.findOne({ username: req.params.userName }, (err, doc) => {
    if (!err) {
      if (doc.username !== req.params.user) {
        if (!doc.followers.includes(req.params.user)) {
          doc.followers.push(req.params.user);
          doc.followBtn = "Following";
          doc.save();
        } else {
          let indexForUnFollow = doc.followers.indexOf(req.params.user);
          doc.followers.splice(indexForUnFollow, 1);
          doc.followBtn = "Follow";
          doc.save();
        }
        return res.json({
          followers: doc.followers.length,
          followBtn: doc.followBtn,
        });
      }
    }
  });
});

app.post("/update-profile/:userName", validateToken, async (req, res) => {
  try {
    const { userName } = req.params;
    const { field, value } = req.body;

    // Validate input
    if (!field) {
      return res.status(400).json({
        status: "error",
        message: "Field is required for profile update.",
      });
    }

    // Ensure the user is updating their own profile
    if (req.user.username !== userName) {
      return res.status(403).json({
        status: "error",
        message: "You are not authorized to update this profile.",
      });
    }

    // Find the user by username
    const user = await User.findOne({ username: userName });
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    // Update the specified field
    if (field === "banner") {
      user.banner = value;
    } else if (field === "bio") {
      user.bio = value;
    } else {
      return res.status(400).json({
        status: "error",
        message: "Invalid field. Only 'banner' and 'bio' can be updated.",
      });
    }

    // Save the updated user
    await user.save();

    return res.status(200).json({
      status: "ok",
      message: `${
        field.charAt(0).toUpperCase() + field.slice(1)
      } updated successfully.`,
    });
  } catch (err) {
    console.error("Error updating profile:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
});
// search page
app.get("/search/:user", (req, res) => {
  // res.setHeader("Access-Control-Allow-Origin", "*");
  // res.header(
  //   "Access-Control-Allow-Headers",
  //   "Origin, X-Requested-With, Content-Type, Accept"
  // );

  User.find(
    { username: { $regex: `${req.params.user}`, $options: "i" } },
    function (err, docs) {
      if (!err) {
        return res.json({ status: "ok", users: docs });
      } else return res.json({ status: "error", error: err });
    }
  );
});

app.get("/topic/:tag", async (req, res) => {
  const token = req.headers["x-access-token"];

  // res.setHeader("Access-Control-Allow-Origin", "*");
  // res.header(
  //   "Access-Control-Allow-Headers",
  //   "Origin, X-Requested-With, Content-Type, Accept"
  // );

  const tweetsToSkip = req.query.t || 0;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const username = decoded.username;
    const user = await User.findOne({ username: username });
    Tweet.find({ isRetweeted: false, tag: req.params.tag })
      .populate("postedBy")
      .populate("comments")
      .sort({ createdAt: -1 })
      .skip(tweetsToSkip)
      .limit(20)
      .exec((err, docs) => {
        if (!err) {
          //to know if a person has liked tweet
          docs.forEach((doc) => {
            if (!doc.likes.includes(username)) {
              doc.likeTweetBtn = "black";
              doc.save();
            } else {
              doc.likeTweetBtn = "deeppink";
              doc.save();
            }
          });

          //to know if a person has liked comment
          docs.forEach((doc) => {
            doc.comments.forEach((docComment) => {
              if (!docComment.likes.includes(username)) {
                docComment.likeCommentBtn = "black";
                docComment.save();
              } else {
                docComment.likeCommentBtn = "deeppink";
                docComment.save();
              }
            });
          });

          //to know if a person has retweeted the tweet
          docs.forEach((doc) => {
            if (!doc.retweets.includes(username)) {
              doc.retweetBtn = "black";
            } else {
              doc.retweetBtn = "green";
            }
          });

          return res.json({
            status: "ok",
            tweets: docs,
            activeUser: user,
          });
        }
      });
  } catch (error) {
    return res.json({ status: "error", error: "Session ended :(" });
  }
});

app.listen(port, () => {
  console.log("server running on port " + port);
});
