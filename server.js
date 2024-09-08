var dotenv= require('dotenv');
dotenv.config({path: './Config.env'});

const express = require("express");
const app = express();
const http = require("http").createServer(app);
const socketIo = require('socket.io');
const formidable = require("formidable");
const fs = require("fs");
const mongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectId;
const bodyParser = require("body-parser");
const expressSession = require("express-session");
const bcrypt = require("bcryptjs");
const path = require('path');

const cloudinary = require('cloudinary').v2;
const { getVideoDurationInSeconds } = require('get-video-duration');

console.log('Cloudinary env :', process.env);
console.log('Cloudinary Cloud Name2:', process.env.ClOUDINARY_CLOUD_NAME);
console.log('Cloudinary API Key2:', process.env.ClOUDINARY_PUBLIC_KEY);
console.log('Cloudinary API Secret2:', process.env.ClOUDINARY_SECRET_KEY);

cloudinary.config({
    cloud_name: process.env.ClOUDINARY_CLOUD_NAME,
    api_key: process.env.ClOUDINARY_PUBLIC_KEY,
    api_secret: process.env.ClOUDINARY_SECRET_KEY
});



let database = null;

app.use(bodyParser.json({ limit: "10000mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10000mb", parameterLimit: 1000000 }));

app.use(expressSession({
    key: "user_id",
    secret: "User secret object ID",
    resave: true,
    saveUninitialized: true
}));

app.use("/public", express.static(__dirname + "/public"));
app.set("view engine", "ejs");

function getUser(userId, callback) {
    database.collection("users").findOne({ "_id": ObjectId(userId) }, (error, result) => {
        if (error) {
            console.log(error);
            return;
        }
        if (callback != null) {
            callback(result);
        }
    });
}

http.listen(process.env.PORT, () => {
    console.log(`Server started at http://localhost:${process.env.PORT}/`);
    const io = socketIo(http);

    io.on('connection', (socket) => {
        console.log('A user connected');
        socket.on('disconnect', () => {
            console.log('User disconnected');
        });
    });

    mongoClient.connect(process.env.DB, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    }, (error, client) => {
        if (error) {
            console.log(error);
            return;
        }
        database = client.db("tv_app");

        // Admin routes
        app.get("/register", (req, res) => {
            if (req.session.user_id) {
                res.redirect("/");
                return;
            }
            res.render("register", { error: "", message: "" });
        });

        app.post("/register", (req, res) => {
            const { first_name, last_name, email, password, role } = req.body;

            if (!first_name || !last_name || !email || !password || !role) {
                res.render("register", { error: "Please fill all fields", message: "" });
                return;
            }

            database.collection("users").findOne({ email }, (error1, user) => {
                if (error1) {
                    console.log(error1);
                    return;
                }

                if (user == null) {
                    bcrypt.genSalt(10, (err, salt) => {
                        bcrypt.hash(password, salt, (err, hash) => {
                            database.collection("users").insertOne({
                                first_name, last_name, email, password: hash, role,
                                ...(role === 'tv' && {
                                    playlists: [],
                                    details: { name: "", location: "", brand: "", connectionStatus: "", powerStatus: "" },
                                    videos: []
                                })
                            }, (error2) => {
                                if (error2) {
                                    console.log(error2);
                                    return;
                                }
                                res.render("register", { error: "", message: "Signed up successfully. You can login now." });
                            });
                        });
                    });
                } else {
                    res.render("register", { error: "Email already exists", message: "" });
                }
            });
        });

        app.get("/login", (req, res) => {
            if (req.session.user_id) {
                res.redirect("/");
                return;
            }
            res.render("login", { error: "", message: "" });
        });

// POST /login - Handle user (admin/TV) login
app.post("/login", (req, res) => {
    const { email, password, name } = req.body;

    if ((!email || !password) && !name) {
        res.render("login", { error: "Please fill all fields", message: "" });
        return;
    }

    if (email && password) {
        // Admin login
        database.collection("users").findOne({ email }, (error1, user) => {
            if (error1) {
                console.log(error1);
                return;
            }

            if (user == null) {
                res.render("login", { error: "Email does not exist", message: "" });
            } else {
                bcrypt.compare(password, user.password, (error2, result) => {
                    if (result) {
                        req.session.user_id = user._id;
                        req.session.role = user.role;
                        res.redirect("/");
                    } else {
                        res.render("login", { error: "Password is not correct", message: "" });
                    }
                });
            }
        });
    } else if (name) {
        // TV login
        database.collection("tvs").findOne({ name }, (error1, tv) => {
            if (error1) {
                console.log('Error finding TV:', error1);
                res.status(500).send('Internal Server Error');
            } else if (!tv) {
                res.render("login", { error: "TV not found", message: "" });
            } else {
                req.session.user_id = tv._id;
                req.session.role = 'tv';
                res.redirect(`/home`);
            }
        });
    }
});


       /* app.post("/login", (req, res) => {
            const { email, password } = req.body;

            if (!email || !password) {
                res.render("login", { error: "Please fill all fields", message: "" });
                return;
            }

            database.collection("users").findOne({ email }, (error1, user) => {
                if (error1) {
                    console.log(error1);
                    return;
                }

                if (user == null) {
                    res.render("login", { error: "Email does not exist", message: "" });
                } else {
                    bcrypt.compare(password, user.password, (error2, result) => {
                        if (result) {
                            req.session.user_id = user._id;
                            req.session.role = user.role;
                            res.redirect("/");
                        } else {
                            res.render("login", { error: "Password is not correct", message: "" });
                        }
                    });
                }
            });
        });*/

        app.get("/logout", (req, res) => {
            req.session.destroy();
            res.redirect("/login");
        });

        // Admin dashboard
        app.get("/", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                res.render("index", { isLogin: true });
            } else {
                res.redirect("/login");
            }
        });



        app.get('/listTVs', (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const { search } = req.query;
                let query = {};
        
                if (search) {
                    query = {
                        $or: [
                            { name: new RegExp(search, 'i') }, // Case-insensitive search for name
                            { description: new RegExp(search, 'i') } // Case-insensitive search for description
                        ]
                    };
                }
        
                database.collection('tvs').find(query).toArray((error, tvs) => {
                    if (error) {
                        console.log('Error fetching TVs:', error);
                        res.status(500).send('Internal Server Error');
                    } else {
                        res.render('listTVs', {
                            tvs,
                            search: search || '', // Pass the search term to the template
                            error: "",   // Pass an empty string if no error
                            success: ""  // Pass an empty string if no success message
                        });
                    }
                });
            } else {
                res.status(401).send('Unauthorized');
            }
        });
        
        
        
        
        

        app.post("/assignPlaylist", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const { tv_id, playlist } = req.body;
        
                database.collection("tvs").updateOne(
                    { _id: ObjectId(tv_id) },
                    { $set: { playlist: ObjectId(playlist) } },
                    (error, result) => {
                        if (error) {
                            console.log("Error assigning playlist:", error);
                            res.render("tvDetails", {
                                tv: {}, // Remplacez par les détails de la TV
                                playlists: [], // Remplacez par les playlists disponibles
                                error: "Failed to assign playlist",
                                success: ""
                            });
                        } else {
                            database.collection("tvs").findOne({ "_id": ObjectId(tv_id) }, (err, tv) => {
                                if (err || !tv) {
                                    res.render("tvDetails", {
                                        tv: {},
                                        playlists: [],
                                        error: "TV not found after updating",
                                        success: ""
                                    });
                                } else {
                                    database.collection("playlists").find().toArray((err2, playlists) => {
                                        if (err2) {
                                            res.render("tvDetails", {
                                                tv,
                                                playlists: [],
                                                error: "Error retrieving playlists",
                                                success: ""
                                            });
                                        } else {
                                            res.render("tvDetails", {
                                                tv,
                                                playlists,
                                                error: "",
                                                success: "Playlist assigned successfully"
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    }
                );
            } else {
                res.redirect("/login");
            }
        });
        
        


        app.get("/tvDetails/:id", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const tvId = req.params.id;
        
                database.collection("tvs").findOne({ "_id": ObjectId(tvId) }, (err, tv) => {
                    if (err || !tv) {
                        console.log(err || "TV not found");
                        res.status(404).render("tvDetails", { tv: {}, playlists: [], error: "TV not found" });
                        return;
                    }
        
                    database.collection("playlists").find().toArray((err2, playlists) => {
                        if (err2) {
                            console.log(err2);
                            res.status(500).render("tvDetails", { tv, playlists: [], error: "Error retrieving playlists", success: "" });
                            return;
                        }
        
                        res.render("tvDetails", { tv, playlists, error: "", success: "" });
                    });
                });
            } else {
                res.redirect("/login");
            }
        });
        
    
        

        app.get("/videos", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                // Récupérer les paramètres de recherche et de filtre
                const { search, startDate, endDate } = req.query;
                let query = {};
        
                // Ajouter le filtre par date
                if (startDate || endDate) {
                    query.createdAt = {};
                    if (startDate) {
                        // Convertir startDate en Unix timestamp (en millisecondes)
                        const startTimestamp = new Date(startDate).getTime();
                        query.createdAt.$gte = startTimestamp;
                    }
                    if (endDate) {
                        // Convertir endDate en Unix timestamp (en millisecondes)
                        const endTimestamp = new Date(endDate).getTime();
                        query.createdAt.$lte = endTimestamp;
                    }
                }
        
                // Ajouter le filtre de recherche par nom ou description
                if (search) {
                    query.$or = [
                        { title: new RegExp(search, 'i') },
                        { description: new RegExp(search, 'i') }
                    ];
                }
        
                // Fetch filtered videos
                database.collection("videos").find(query).toArray((error, videos) => {
                    if (error) {
                        console.log("Error fetching videos:", error);
                        res.status(500).send('Internal Server Error');
                        return;
                    }
                    
                    // Fetch all playlists for dropdown
                    database.collection("playlists").find().toArray((error1, playlists) => {
                        if (error1) {
                            console.log("Error fetching playlists:", error1);
                            res.status(500).send('Internal Server Error');
                            return;
                        }
        
                        // Pass the search and filter parameters to the view
                        res.render("videos", { 
                            videos, 
                            playlists, 
                            error: "", 
                            success: "", 
                            search: search || '', 
                            startDate: startDate || '', 
                            endDate: endDate || '' 
                        });
                    });
                });
            } else {
                res.redirect("/login");
            }
        });
        
// Endpoint to handle video association with a playlist
app.post("/associateVideo", (req, res) => {
    if (req.session.user_id && req.session.role === 'admin') {
        const { videoId, playlistId } = req.body;

        if (!videoId || !playlistId) {
            res.redirect("/videos?error=Please select a video and a playlist");
            return;
        }

        // Add video to the selected playlist
        database.collection("playlists").updateOne(
            { _id: ObjectId(playlistId) },
            { $addToSet: { videos: ObjectId(videoId) } },
            (error, result) => {
                if (error) {
                    console.log("Error associating video:", error);
                    res.redirect("/videos?error=Internal Server Error");
                } else {
                    res.redirect("/videos?success=Video successfully associated with playlist");
                }
            }
        );
    } else {
        res.redirect("/login");
    }
});









// Serve the upload form
app.get('/upload', (req, res) => {
    res.render('upload', { error: null });
});

  // Handle file uploads
app.post('/uploads', (req, res) => {
    if (req.session && req.session.user_id) {
        const form = new formidable.IncomingForm();
        form.uploadDir = path.join(__dirname, 'public/videos'); // Specify the upload directory
        form.keepExtensions = true; // Keep file extensions
        form.parse(req, (err, fields, files) => {
            if (err) {
                console.error('Error parsing form:', err);
                return res.status(500).send('Internal Server Error');
            }

            const oldPath = files.video.path;
            const newPath ="public/videos/" + new Date().getTime() + "-" + files.video.name; //path.join(__dirname, 'public/videos', new Date().getTime() + '-' + files.video.name);
            const title = fields.title;
            const description = fields.description;
            const tags = fields.tags;
            const category = fields.category;

            const oldPathThumbnail = files.thumbnail.path;
            const thumbnail = "public/thumbnails/" + new Date().getTime() + "-" + files.thumbnail.name; //path.join(__dirname, 'public/thumbnails', new Date().getTime() + '-' + files.thumbnail.name);

            fs.rename(oldPathThumbnail, thumbnail, (err) => {
                if (err) console.error('Thumbnail upload error:', err);
            });

            fs.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error('Video upload error:', err);
                    return res.status(500).send('Internal Server Error');
                }

                getVideoDurationInSeconds(newPath).then((duration) => {
                    const hours = Math.floor(duration / 3600);
                    const minutes = Math.floor((duration % 3600) / 60);
                    const seconds = Math.floor(duration % 60);

                    database.collection('videos').insertOne({
                        filePath: newPath,
                        createdAt: new Date().getTime(),
                        views: 0,
                        watch: new Date().getTime(),
                        minutes,
                        seconds,
                        hours,
                        title,
                        description,
                        tags,
                        category,
                        thumbnail
                    }, (err, data) => {
                        if (err) {
                            console.error('Error saving video to database:', err);
                            return res.status(500).send('Internal Server Error');
                        }

                        database.collection('users').updateOne({
                            _id: ObjectId(req.session.user_id)
                        }, {
                            $push: {
                                videos: {
                                    _id: data.insertedId,
                                    filePath: newPath,
                                    createdAt: new Date().getTime(),
                                    views: 0,
                                    watch: new Date().getTime(),
                                    minutes,
                                    seconds,
                                    hours,
                                    title,
                                    description,
                                    tags,
                                    category,
                                    thumbnail
                                }
                            }
                        }, (err) => {
                            if (err) {
                                console.error('Error updating user with video:', err);
                                return res.status(500).send('Internal Server Error');
                            }

                            res.redirect(`/videos`);
                        });
                    });
                });
            });
        });
    } else {
        res.json({
            status: 'error',
            message: 'Please login to perform this action.'
        });
    }
});

app.post('/upload-video', (req, res) => {
    if (!req.session || !req.session.user_id) {
        return res.status(401).json({ status: 'error', message: 'Please login to perform this action.' });
    }

    const form = new formidable.IncomingForm();
    form.keepExtensions = true;
    console.log(process.env.ClOUDINARY_CLOUD_NAME);
    console.log(process.env.ClOUDINARY_SECRET_KEY);
    console.log(process.env.ClOUDINARY_PUBLIC_KEY);

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error('Error parsing form:', err);
            return res.status(500).send('Error processing form data.');
        }

        const { title, description, tags, category } = fields;
        const videoFile = files.video;
        const thumbnailFile = files.thumbnail;

        if (!videoFile || !thumbnailFile) {
            console.error('Missing video or thumbnail files');
            return res.status(400).send('Both video and thumbnail files are required.');
        }

        try {
            // Upload video to Cloudinary
            const videoUploadResult = await cloudinary.uploader.upload(videoFile.path, {
                resource_type: "video",
                folder: "videos"
            });

            // Upload thumbnail to Cloudinary
            const thumbnailUploadResult = await cloudinary.uploader.upload(thumbnailFile.path, {
                resource_type: "image",
                folder: "thumbnails"
            });

            const duration = await getVideoDurationInSeconds(videoUploadResult.secure_url);
			const hours = Math.floor(duration / 3600);
			const minutes = Math.floor((duration % 3600) / 60);
			const seconds = Math.floor(duration % 60);
			const currentTime = Date.now();
            
            // Insert video data into the database
            const videoData = {
                filePath: videoUploadResult.secure_url,
                createdAt: new Date().getTime(),
                views: 0,
                watch: new Date().getTime(),
                minutes,
                seconds,
                hours,
                title,
                description,
                tags,
                category,
                thumbnail: thumbnailUploadResult.secure_url
            };

            database.collection('videos').insertOne(videoData, (err, data) => {
                if (err) {
                    console.error('Error saving video to database:', err);
                    return res.status(500).send('Database error.');
                }

                // Update the user's video list
                database.collection('users').updateOne(
                    { _id: ObjectId(req.session.user_id) },
                    { $push: { videos: { ...videoData, _id: data.insertedId } } },
                    (err) => {
                        if (err) {
                            console.error('Error updating user with video:', err);
                            return res.status(500).send('Error updating user with video.');
                        }

                        res.redirect(`/videos`);
                    }
                );
            });
        } catch (uploadError) {
            console.error('Upload error:', uploadError);
            res.status(500).send('Internal Server Error');
        }
    });
});


app.post('/upload', (req, res) => {
    if (req.session && req.session.user_id) {
        const form = new formidable.IncomingForm();
        form.keepExtensions = true; // Keep file extensions

        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error('Error parsing form:', err);
                return res.status(500).send('Internal Server Error');
            }

            const { title, description, tags, category } = fields;
            const videoFile = files.video;
            const thumbnailFile = files.thumbnail;

	    console.log(process.env.ClOUDINARY_CLOUD_NAME);
    	    console.log(process.env.ClOUDINARY_SECRET_KEY);
            console.log(process.env.ClOUDINARY_PUBLIC_KEY);

            try {
                // Upload video to Cloudinary
                const videoUploadResult = await cloudinary.uploader.upload(videoFile.path, {
                    resource_type: "video",
                    folder: "videos"
                });

                // Upload thumbnail to Cloudinary
                const thumbnailUploadResult = await cloudinary.uploader.upload(thumbnailFile.path, {
                    resource_type: "image",
                    folder: "thumbnails"
                });

                // Get video duration
                const duration = await getVideoDurationInSeconds(videoUploadResult.secure_url);
                const hours = Math.floor(duration / 3600);
                const minutes = Math.floor((duration % 3600) / 60);
                const seconds = Math.floor(duration % 60);

                // Insert video data into the database
                const videoData = {
                    filePath: videoUploadResult.secure_url,
                    createdAt: new Date().getTime(),
                    views: 0,
                    watch: new Date().getTime(),
                    minutes,
                    seconds,
                    hours,
                    title,
                    description,
                    tags,
                    category,
                    thumbnail: thumbnailUploadResult.secure_url
                };

                database.collection('videos').insertOne(videoData, (err, data) => {
                    if (err) {
                        console.error('Error saving video to database:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    // Update the user's video list
                    database.collection('users').updateOne(
                        { _id: ObjectId(req.session.user_id) },
                        { $push: { videos: { ...videoData, _id: data.insertedId } } },
                        (err) => {
                            if (err) {
                                console.error('Error updating user with video:', err);
                                return res.status(500).send('Internal Server Error');
                            }

                            res.redirect(`/videos`);
                        }
                    );
                });
            } catch (uploadError) {
                console.error('Upload error:', uploadError);
                res.status(500).send('Internal Server Error');
            }
        });
    } else {
        res.json({
            status: 'error',
            message: 'Please login to perform this action.'
        });
    }
});



        // Endpoint to delete a video
app.post("/deleteVideo", (req, res) => {
    if (req.session.user_id && req.session.role === 'admin') {
        const { videoId } = req.body;

        if (!videoId) {
            res.redirect("/videos?error=Video ID is required");
            return;
        }

        // Remove the video from all playlists and other relevant collections
        database.collection("playlists").updateMany(
            { videos: ObjectId(videoId) },
            { $pull: { videos: ObjectId(videoId) } },
            (error1, result1) => {
                if (error1) {
                    console.log("Error removing video from playlists:", error1);
                    res.redirect("/videos?error=Internal Server Error");
                    return;
                }

                // Remove the video from the videos collection
                database.collection("videos").deleteOne({ _id: ObjectId(videoId) }, (error2, result2) => {
                    if (error2) {
                        console.log("Error deleting video:", error2);
                        res.redirect("/videos?error=Internal Server Error");
                        return;
                    }

                    res.redirect("/videos?success=Video successfully deleted");
                });
            }
        );
    } else {
        res.redirect("/login");
    }
});








        // Route GET pour afficher le formulaire de création de playlist
        app.get("/createPlaylist", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                res.render("createPlaylist", { error: "", message: "" });
            } else {
                res.redirect("/login");
            }
        });


// Route POST pour /createPlaylist
app.post('/createPlaylist', (req, res) => {
    if (req.session.user_id && req.session.role === 'admin') {
        const { title, description } = req.body;

        const newPlaylist = { title, description, videos: [], createdAt: new Date() };

        // Enregistrer la nouvelle playlist dans MongoDB
        database.collection('playlists').insertOne(newPlaylist, (err, result) => {
            if (err) {
                console.error('Error saving playlist:', err);
                res.status(500).send('Internal Server Error');
            } else {
                //res.send('Playlist created successfully');
                res.redirect(`/playlists`);
            }
        });
    } else {
        res.status(401).send('Unauthorized');
    }
});
        

        app.get('/viewVideo/:videoId', (req, res) => {
            const videoId = req.params.videoId;
            
            // Trouver le fichier vidéo dans la base de données
            database.collection('videos').findOne({ _id: ObjectId(videoId) }, (err, video) => {
                if (err) {
                    console.log(err);
                    res.status(500).send('Internal Server Error');
                    return;
                }
                if (video) {
                    res.render('viewVideo', { video: video });

                } else {
                    res.status(404).send('Video not found');
                }
            });
        });

        app.get('/viewVideoTv/:videoId', (req, res) => {
            const videoId = req.params.videoId;
            
            // Trouver le fichier vidéo dans la base de données
            database.collection('videos').findOne({ _id: ObjectId(videoId) }, (err, video) => {
                if (err) {
                    console.log(err);
                    res.status(500).send('Internal Server Error');
                    return;
                }
                if (video) {
                    res.render('viewVideoTv', { video: video });

                } else {
                    res.status(404).send('Video not found');
                }
            });
        });

        app.post('/removeVideoFromPlaylist/:videoId', (req, res) => {
            const videoId = req.params.videoId;
            const playlistId = req.body.playlistId;
        
            if (!playlistId) {
                res.status(400).send('Playlist ID is required');
                return;
            }
        
            // Retirer la vidéo de la playlist spécifiée
            database.collection('playlists').updateOne(
                { _id: ObjectId(playlistId) },
                { $pull: { videos: ObjectId(videoId) } },
                (err) => {
                    if (err) {
                        console.log(err);
                        res.status(500).send('Internal Server Error');
                        return;
                    }
        
                    // Rediriger vers les détails de la playlist après la suppression
                    res.redirect(`/playlist/${playlistId}`); // Assurez-vous que cette route est définie pour afficher les détails de la playlist
                }
            );
        });
        





        //Add an endpoint for TV login:
        app.post('/loginTV', (req, res) => {
            const { name } = req.body;
            database.collection('tvs').findOne({ name }, (error, tv) => {
                if (error) {
                    console.log('Error finding TV:', error);
                    res.status(500).send('Internal Server Error');
                } else if (tv) {
                    req.session.tv_id = tv._id; // Store TV ID in session
                    res.send('TV logged in successfully');
                } else {
                    res.status(401).send('TV not found');
                }
            });
        });
        



// GET /createTV - Render the Create TV Account form
app.get('/createTV', (req, res) => {
    if (req.session.user_id && req.session.role === 'admin') {
        res.render('createTV');
    } else {
        res.redirect('/login');
    }
});
        app.post('/createTV', (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const { name, location, brand, connectionStatus, powerStatus } = req.body;
                const newTV = {
                    name,
                    location,
                    brand,
                    connectionStatus,
                    powerStatus,
                    playlist: null // Initially, no playlist associated
                };
        
                database.collection('tvs').insertOne(newTV, (error, result) => {
                    if (error) {
                        console.log('Error creating TV:', error);
                        res.status(500).send('Internal Server Error');
                    } else {
                        res.redirect(`/listTVs`); 
                        //res.render('/listTVs')
                    }
                });
            } else {
                res.status(401).send('Unauthorized');
            }
        });
        



        app.get("/playlists", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const { search, startDate, endDate } = req.query;
                let query = {};
        
                // Add search filter
                if (search) {
                    query.$or = [
                        { title: new RegExp(search, 'i') },
                        { description: new RegExp(search, 'i') }
                    ];
                }
        
                // Add date filter
                if (startDate || endDate) {
                    query.createdAt = {};
                    if (startDate) {
                        // Ensure startDate is in ISO 8601 format and set start time to 00:00:00
                        const start = new Date(startDate);
                        start.setHours(0, 0, 0, 0);
                        query.createdAt.$gte = start.toISOString();
                    }
                    if (endDate) {
                        // Ensure endDate is in ISO 8601 format and set end time to 23:59:59
                        const end = new Date(endDate);
                        end.setHours(23, 59, 59, 999);
                        query.createdAt.$lte = end.toISOString();
                    }
                }
        
                // Fetch filtered playlists
                database.collection("playlists").find(query).toArray((error, playlists) => {
                    if (error) {
                        console.log("Error fetching playlists:", error);
                        res.status(500).send('Internal Server Error');
                    } else {
                        res.render("playlists", { playlists, error: "", success: "", search: search || '', startDate: startDate || '', endDate: endDate || '' });
                    }
                });
            } else {
                res.redirect("/login");
            }
        });
        
        
        
        

        app.get("/playlist/:id", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const playlistId = req.params.id;
        
                database.collection("playlists").findOne({ _id: ObjectId(playlistId) }, (error, playlist) => {
                    if (error) {
                        console.log("Error fetching playlist:", error);
                        res.status(500).send('Internal Server Error');
                    } else {
                        if (playlist) {
                            database.collection("videos").find({ "_id": { $in: playlist.videos.map(id => ObjectId(id)) } }).toArray((error1, videos) => {
                                if (error1) {
                                    console.log("Error fetching videos:", error1);
                                    res.status(500).send('Internal Server Error');
                                } else {
                                    res.render("playlistDetails", { playlist, videos, error: "", success: "" });
                                }
                            });
                        } else {
                            res.status(404).send('Playlist not found');
                        }
                    }
                });
            } else {
                res.redirect("/login");
            }
        });
        








      /*  app.post("/associate_playlist_to_tv", (req, res) => {
            if (req.session.user_id && req.session.role === 'admin') {
                const { tvId, playlistId } = req.body;
                database.collection("users").updateOne(
                    { "_id": ObjectId(tvId) },
                    { $set: { "playlists": [playlistId] } },
                    (error) => {
                        if (error) {
                            console.log(error);
                            res.redirect("/");
                            return;
                        }
                        res.redirect("/");
                    }
                );
            } else {
                res.redirect("/login");
            }
        });*/

        // TV functionality
  /*      app.post("/tvDetails/update", (req, res) => {
            if (req.session.user_id && req.session.role === 'tv') {
                const { name, location, brand, connectionStatus, powerStatus } = req.body;
                database.collection("users").updateOne(
                    { "_id": ObjectId(req.session.user_id) },
                    { $set: { "details": { name, location, brand, connectionStatus, powerStatus } } },
                    (error) => {
                        if (error) {
                            console.log(error);
                            res.redirect("/tvDetails");
                            return;
                        }
                        res.redirect("/tvDetails");
                    }
                );
            } else {
                res.redirect("/login");
            }
        });
*/

      /*  app.get("/tvDetails/videos", (req, res) => {
            if (req.session.user_id && req.session.role === 'tv') {
                database.collection("users").findOne({ "_id": ObjectId(req.session.user_id) }, (error, user) => {
                    if (error) {
                        console.log(error);
                        return;
                    }
                    if (user && user.playlists.length > 0) {
                        const playlistId = user.playlists[0]; // Assuming one playlist per TV
                        database.collection("playlists").findOne({ "_id": ObjectId(playlistId) }, (error1, playlist) => {
                            if (error1) {
                                console.log(error1);
                                return;
                            }
                            if (playlist) {
                                database.collection("videos").find({ "_id": { $in: playlist.videos.map(id => ObjectId(id)) } }).toArray((error2, videos) => {
                                    if (error2) {
                                        console.log(error2);
                                        return;
                                    }
                                    res.render("tvDetails", { details: user.details, videos });
                                });
                            } else {
                                res.render("tvDetails", { details: user.details, videos: [] });
                            }
                        });
                    } else {
                        res.render("tvDetails", { details: user.details, videos: [] });
                    }
                });
            } else {
                res.redirect("/login");
            }
        });*/










// TV Dashboard
app.get("/home", (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        const tvId = req.session.user_id; // Assuming user_id is the TV ID

        database.collection('tvs').findOne({ _id: new ObjectId(tvId) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                res.status(500).send('Internal Server Error');
            } else if (tv) {
                res.render('home', { isLogin: true, tv: tv });
            } else {
                res.status(404).send('TV not found');
            }
        });
    } else {
        res.redirect("/login");
    }
});

// Afficher les détails de la télévision et la playlist associée
app.get('/tvDetails/:id', (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        const tvId = req.params.id;

        database.collection('tvs').findOne({ _id: new ObjectId(tvId) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                res.status(500).send('Internal Server Error');
            } else if (tv) {
                database.collection('videos').find({ playlist: tv.playlist }).toArray((err, videos) => {
                    if (err) {
                        console.log('Error fetching videos:', err);
                        res.status(500).send('Internal Server Error');
                    } else {
                        res.render('tvDetailstv', {
                            tv,
                            videos,
                            error: "",
                            success: ""
                        });
                    }
                });
            } else {
                res.status(404).send('TV not found');
            }
        });
    } else {
        res.status(401).send('Unauthorized');
    }
});


// Afficher les détails de la télévision et la playlist associée
app.get('/tvDetailstv', (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        const tvId = req.query.id;  // Retrieve TV ID from query parameters

        if (!tvId) {
            return res.status(400).send('Bad Request: Missing TV ID');
        }

        // Step 1: Fetch TV Document
        database.collection('tvs').findOne({ _id: new ObjectId(tvId) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                res.status(500).send('Internal Server Error');
            } else if (tv) {
                console.log('TV found:', tv);

                // Step 2: Use Playlist ID from TV Document
                const playlistId = tv.playlist;

                // Fetch Playlist Details
                database.collection('playlists').findOne({ _id: new ObjectId(playlistId) }, (err, playlist) => {
                    if (err) {
                        console.log('Error fetching playlist:', err);
                        res.status(500).send('Internal Server Error');
                    } else if (playlist) {
                        console.log('Playlist found:', playlist);

                        // Step 3: Extract Video IDs from Playlist
                        const videoIds = playlist.videos;

                        if (videoIds.length === 0) {
                            console.log('No videos in this playlist');
                            return res.render('tvDetailstv', {
                                tv,
                                videos: [],
                                error: "No videos found in this playlist.",
                                success: ""
                            });
                        }

                        // Fetch Videos from `videos` Collection
                        database.collection('videos').find({ _id: { $in: videoIds.map(id => new ObjectId(id)) } }).toArray((err, videos) => {
                            if (err) {
                                console.log('Error fetching videos:', err);
                                res.status(500).send('Internal Server Error');
                            } else {
                                console.log('Videos found:', videos);
                                res.render('tvDetailstv', {
                                    tv,
                                    videos,
                                    error: "",
                                    success: ""
                                });
                            }
                        });
                    } else {
                        res.status(404).send('Playlist not found');
                    }
                });
            } else {
                res.status(404).send('TV not found');
            }
        });
    } else {
        res.status(401).send('Unauthorized');
    }
});



// Endpoint to display the playlist and videos for the TV user
app.get('/myPlaylist', (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        // Retrieve TV details
        database.collection('tvs').findOne({ _id: new ObjectId(req.session.user_id) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                res.status(500).send('Internal Server Error');
            } else if (tv) {
                // Retrieve playlist details
                database.collection('playlists').findOne({ _id: new ObjectId(tv.playlist) }, (err, playlist) => {
                    if (err) {
                        console.log('Error fetching playlist:', err);
                        res.status(500).send('Internal Server Error');
                    } else if (playlist) {
                        // Retrieve videos associated with the playlist
                        database.collection('videos').find({ _id: { $in: playlist.videos.map(id => new ObjectId(id)) } }).toArray((err, videos) => {
                            if (err) {
                                console.log('Error fetching videos:', err);
                                res.status(500).send('Internal Server Error');
                            } else {
                                res.render('myPlaylist', {
                                    playlist,
                                    videos
                                });
                            }
                        });
                    } else {
                        res.status(404).send('Playlist not found');
                    }
                });
            } else {
                res.status(404).send('TV not found');
            }
        });
    } else {
        res.status(401).send('Unauthorized');
    }
});







/*
app.get('/myPlaylistes', (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        // Retrieve TV details
        database.collection('tvs').findOne({ _id: new ObjectId(req.session.user_id) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                res.status(500).send('Internal Server Error');
            } else if (tv) {
                // Retrieve playlist details
                database.collection('playlists').findOne({ _id: new ObjectId(tv.playlist) }, (err, playlist) => {
                    if (err) {
                        console.log('Error fetching playlist:', err);
                        res.status(500).send('Internal Server Error');
                    } else if (playlist) {
                        // Retrieve videos associated with the playlist
                        database.collection('videos').find({ _id: { $in: playlist.videos.map(id => new ObjectId(id)) } }).toArray((err, videos) => {
                            if (err) {
                                console.log('Error fetching videos:', err);
                                res.status(500).send('Internal Server Error');
                            } else {
                                // Transform video data to the desired format
                                const transformedVideos = videos.map(video => ({
                                    url: video.filePath, // Assuming filePath contains the URL
                                    filename: video.fileName // Assuming fileName contains the filename
                                }));

                                // Send the transformed video data as JSON response
                                res.json(transformedVideos);
                            }
                        });
                    } else {
                        res.status(404).send('Playlist not found');
                    }
                });
            } else {
                res.status(404).send('TV not found');
            }
        });
    } else {
        res.status(401).send('Unauthorized');
    }
});





app.get('/My-Playlistes', (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        // Retrieve TV details
        database.collection('tvs').findOne({ _id: new ObjectId(req.session.user_id) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                res.status(500).send('Internal Server Error');
            } else if (tv) {
                // Retrieve playlist details
                database.collection('playlists').findOne({ _id: new ObjectId(tv.playlist) }, (err, playlist) => {
                    if (err) {
                        console.log('Error fetching playlist:', err);
                        res.status(500).send('Internal Server Error');
                    } else if (playlist) {
                        // Retrieve videos associated with the playlist
                        database.collection('videos').find({ _id: { $in: playlist.videos.map(id => new ObjectId(id)) } }).toArray((err, videos) => {
                            if (err) {
                                console.log('Error fetching videos:', err);
                                res.status(500).send('Internal Server Error');
                            } else {
                                // Initialize the array to hold transformed video data
                                const playlistLinks = [];
                                
                                // Regular expression to extract filename from filePath
                                const regex = /\/([^/]*)$/;
                                
                                // Transform video data
                                videos.forEach(video => {
                                    const filenameMatch = (video.filePath).match(regex);
                                    const filename = filenameMatch ? filenameMatch[1] : 'unknown.mp4'; // Fallback filename if no match
                                    playlistLinks.push({
                                        url: video.filePath,
                                        filename: filename
                                    });
                                });

                                // Send the transformed video data as JSON response
                                res.json(playlistLinks);
                            }
                        });
                    } else {
                        res.status(404).send('Playlist not found');
                    }
                });
            } else {
                res.status(404).send('TV not found');
            }
        });
    } else {
        res.status(401).send('Unauthorized');
    }
});




app.put('/updateTVStatus/:tvId', (req, res) => {
    const tvId = req.params.tvId;
    const { internetConnectionStatus, batteryStatus, brand } = req.body;

    if (!ObjectId.isValid(tvId)) {
        return res.status(400).json({ status: 'error', message: 'Invalid TV ID.' });
    }

    // Ensure at least one field is provided to update
    if (internetConnectionStatus === undefined && batteryStatus === undefined && !brand) {
        return res.status(400).json({ status: 'error', message: 'No update data provided.' });
    }

    // Prepare the update object
    const updateData = {};
    if (internetConnectionStatus !== undefined) updateData.internetConnectionStatus = internetConnectionStatus;
    if (batteryStatus !== undefined) updateData.batteryStatus = batteryStatus;
    if (brand) updateData.brand = brand;

    // Update the TV in the collection
    database.collection('tvs').updateOne(
        { _id: ObjectId(tvId) },
        { $set: updateData },
        (err, result) => {
            if (err) {
                console.error('Error updating TV status:', err);
                return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
            }

            if (result.matchedCount === 0) {
                return res.status(404).json({ status: 'error', message: 'TV not found' });
            }

            res.status(200).json({ status: 'success', message: 'TV status updated successfully' });
        }
    );
});*/





/*******************APPLICATION ***********************/
app.post("/loginApp", (req, res) => {
    const { email, password, name } = req.body;

    if ((!email || !password) && !name) {
        return res.status(400).json({ error: "Please fill all fields" });
    }

    if (email && password) {
        // Admin login
        database.collection("users").findOne({ email }, (error1, user) => {
            if (error1) {
                console.log(error1);
                return res.status(500).json({ error: "Internal Server Error" });
            }

            if (user == null) {
                return res.status(404).json({ error: "Email does not exist" });
            } else {
                bcrypt.compare(password, user.password, (error2, result) => {
                    if (result) {
                        req.session.user_id = user._id;
                        req.session.role = user.role;
                        res.json({ userId: user._id, role: user.role });
                    } else {
                        res.status(401).json({ error: "Password is not correct" });
                    }
                });
            }
        });
    } else if (name) {
        // TV login
        database.collection("tvs").findOne({ name }, (error1, tv) => {
            if (error1) {
                console.log('Error finding TV:', error1);
                return res.status(500).json({ error: 'Internal Server Error' });
            } else if (!tv) {
                return res.status(404).json({ error: "TV not found" });
            } else {
                req.session.user_id = tv._id;
                req.session.role = 'tv';
                res.json({ id: tv._id, role: 'tv' });
            }
        });
    }
});


app.get("/home", (req, res) => {
    if (req.session.user_id && req.session.role === 'tv') {
        const tvId = req.session.user_id;

        database.collection('tvs').findOne({ _id: new ObjectId(tvId) }, (error, tv) => {
            if (error) {
                console.log('Error fetching TV:', error);
                return res.status(500).json({ error: 'Internal Server Error' });
            } else if (tv) {
                res.json(tv);
            } else {
                res.status(404).json({ error: 'TV not found' });
            }
        });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});


// GET /My-Playlistes - Retrieve playlist for a specific TV
app.get('/My-Playlistes', (req, res) => {
    const { id, role } = req.query; // Use req.query to get query parameters

    if (!id || !role) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    if (role !== 'tv') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    // Retrieve TV details
    database.collection('tvs').findOne({ _id: new ObjectId(id) }, (error, tv) => {
        if (error) {
            console.log('Error fetching TV:', error);
            return res.status(500).send('Internal Server Error');
        } else if (tv) {
            // Retrieve playlist details
            database.collection('playlists').findOne({ _id: new ObjectId(tv.playlist) }, (err, playlist) => {
                if (err) {
                    console.log('Error fetching playlist:', err);
                    return res.status(500).send('Internal Server Error');
                } else if (playlist) {
                    // Retrieve videos associated with the playlist
                    database.collection('videos').find({ _id: { $in: playlist.videos.map(id => new ObjectId(id)) } }).toArray((err, videos) => {
                        if (err) {
                            console.log('Error fetching videos:', err);
                            return res.status(500).send('Internal Server Error');
                        } else {
                            // Initialize the array to hold transformed video data
                            const playlistLinks = [];

                            // Regular expression to extract filename from filePath
                            const regex = /\/([^/]*)$/;

                            // Transform video data
                            videos.forEach(video => {
                                const filenameMatch = (video.filePath).match(regex);
                                const filename = filenameMatch ? filenameMatch[1] : 'unknown.mp4'; // Fallback filename if no match
                                playlistLinks.push({
                                    url: video.filePath,
                                    filename: filename
                                });
                            });

                            // Send the transformed video data as JSON response
                            res.json(playlistLinks);
                        }
                    });
                } else {
                    res.status(404).send('Playlist not found');
                }
            });
        } else {
            res.status(404).send('TV not found');
        }
    });
});




app.put('/updateTVStatus/:tvId', (req, res) => {
    const tvId = req.params.tvId;
    const { internetConnectionStatus, batteryStatus, brand } = req.body;

    if (!ObjectId.isValid(tvId)) {
        return res.status(400).json({ status: 'error', message: 'Invalid TV ID.' });
    }

    const updateData = {};
    if (internetConnectionStatus !== undefined) updateData.connectionStatus = internetConnectionStatus;
    if (batteryStatus !== undefined) updateData.powerStatus = batteryStatus;
    if (brand) updateData.brand = brand;

    database.collection('tvs').updateOne(
        { _id: ObjectId(tvId) },
        { $set: updateData },
        (err, result) => {
            if (err) {
                console.error('Error updating TV status:', err);
                return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
            }

            if (result.matchedCount === 0) {
                return res.status(404).json({ status: 'error', message: 'TV not found' });
            }

            res.status(200).json({ status: 'success', message: 'TV status updated successfully' });
        }
    );
});



              




    });
});
