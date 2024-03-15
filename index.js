
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
dotenv.config();

const sendOtp = require('./mail');
const client = require('./db');

const app = express();

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/static'));
app.use(express.json());
app.set("trust proxy", true);
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: 'slotsharesessid',
    cookie: {
        secure: true,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
}));
app.use(cookieParser());

//middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        client.query('SELECT verified FROM users WHERE id = $1', [req.session.userId], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            if (result.rows[0].verified) {
                next(); // User is authenticated, continue to next middleware
            } else {
                res.redirect('/verify'); // User is not authenticated, redirect to verify page
            }
        });
    } else {
        res.redirect('/login'); // User is not authenticated, redirect to login page
    }
}

//views
app.get('/', function (req, res) {
    res.render('index', { name: 'John' });
});

app.get('/login', function (req, res) {
    //if already logged in
    if (req.session.userId) {
        res.redirect('/dashboard');
        return;
    }
    res.render('login');
});

app.get('/register', function (req, res) {
    //if already logged in
    if (req.session.userId) {
        res.redirect('/dashboard');
        return;
    }
    res.render('register');
});

app.get('/verify', function (req, res) {
    //if is not logged in, redirect to login
    if (!req.session.userId) {
        res.redirect('/login');
        return;
    }

    //if already verified, redirect to dashboard
    client.query('SELECT verified FROM users WHERE id = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows[0].verified) {
            res.redirect('/dashboard');
            return;
        }
    });


    const code = Math.floor(Math.random() * 9000) + 1000;

    //if user already has a code, update it.
    client.query('SELECT * FROM otp WHERE userId = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length > 0) {
            client.query('UPDATE otp SET code = $1 WHERE userId = $2', [code, req.session.userId], function (err, result) {
                if (err) {
                    res.json({ status: 'error', message: 'Database error' });
                    return;
                }
            });
        } else {
            client.query('INSERT INTO otp (userId, code) VALUES ($1, $2)', [req.session.userId, code], function (err, result) {
                if (err) {
                    res.json({ status: 'error', message: 'Database error' });
                    return;
                }
            });
        }

        //get user name and email
        client.query('SELECT name, email FROM users WHERE id = $1', [req.session.userId], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            const name = result.rows[0].name;
            const email = result.rows[0].email;
            sendOtp(email, code, name);
            res.render('verify');
        });
    });
});

//dashboard
app.get('/dashboard', requireAuth, async function (req, res) {

    // Fetch current user
    const userResult = await client.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
        return res.json({ status: 'error', message: 'User not found' });
    }
    const user = userResult.rows[0];
    if (!user.friends) {
        user.friends = [];
    }

    // Fetch current user's timetable
    let timetableResult = await client.query('SELECT d1, d2, d3, d4, d5 FROM timetable WHERE tid = $1', [user.tid]);
    if (timetableResult.rows.length === 0) {
        timetableResult = { rows: [{}] };
    }
    const timetables = [timetableResult.rows[0]];

    // Fetch friends' codes
    let friendsResult = await client.query('SELECT friends FROM users WHERE id = $1', [req.session.userId]);
    if (friendsResult.rows.length === 0) {
        friendsResult = { rows: [{}] };
    }
    const friends = friendsResult.rows[0].friends;

    // Fetch tids of friends
    const tidsResult = await client.query('SELECT tid FROM users WHERE code = ANY($1)', [friends]);
    const tids = tidsResult.rows.map(row => row.tid);

    // Fetch timetables of friends
    for (const tid of tids) {
        const friendTimetableResult = await client.query('SELECT d1, d2, d3, d4, d5 FROM timetable WHERE tid = $1', [tid]);
        if (friendTimetableResult.rows.length > 0) {
            timetables.push(friendTimetableResult.rows[0]);
        }
    }

    let finalTimetable = [
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];

    // for each timetable in timetables
    for (let i = 0; i < timetables.length; i++) {
        const timetable = timetables[i];
        // for each day in the timetable
        for (const day in timetable) {
            if (Object.prototype.hasOwnProperty.call(timetable, day)) {
                const slots = timetable[day];
                // for each slot in the day
                for (let k = 0; k < slots.length; k++) {
                    // if the slot is free
                    if (slots[k] === 0) {
                        finalTimetable[parseInt(day.substring(1)) - 1][k]++;
                    }
                }
            }
        }
    }

    // divide each slot by the number of timetables times 100 to get the percentage, without decimals
    for (let i = 0; i < finalTimetable.length; i++) {
        for (let j = 0; j < finalTimetable[i].length; j++) {
            finalTimetable[i][j] = Math.round(finalTimetable[i][j] / timetables.length * 100);
        }
    }

    res.render('dashboard', { name: user.name, code: user.code, numFriends: user.friends.length, timetable: finalTimetable });

});


app.get('/friends', requireAuth, function (req, res) {
    client.query('SELECT friends FROM users WHERE id = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        const user = result.rows[0];
        let friends = user.friends;

        //fetch details of each friends (friends is an array of codes)
        client.query('SELECT name, code FROM users WHERE code = ANY($1)', [friends], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            friends = result.rows;
            res.render('friends', { friends: friends });
        });
    });
});

app.get('/timetable', requireAuth, function (req, res) {
    //get tid from user, then get timetable from tid
    client.query('SELECT tid FROM users WHERE id = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        const tid = result.rows[0].tid;
        client.query('SELECT d1, d2, d3, d4, d5 FROM timetable WHERE tid = $1', [tid], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }

            let tt = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];

            if (result.rows.length > 0 && result.rows[0].d1) {
                tt = result.rows[0];
            }

            res.render('timetable', { timetable: tt });
        });
    });
});

app.get('/logout', function (req, res) {
    req.session.userId = null;
    res.redirect('/login');
});

//functions
app.post('/login', function (req, res) {
    //if already logged in
    if (req.session.userId) {
        res.json({ status: 'error', message: 'Already logged in' });
        return;
    }
    const email = req.body.email;
    const password = req.body.password;

    client.query('SELECT * FROM users WHERE email = $1', [email], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length === 0) {
            res.json({ status: 'error', message: 'Email does not exist' });
            return;
        }

        const user = result.rows[0];
        if (bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            res.json({ status: 'success', message: 'Logged in successfully' });
        } else {
            res.json({ status: 'error', message: 'Password is incorrect' });
        }
    });
});

app.post('/register', function (req, res) {
    //if already logged in
    if (req.session.userId) {
        res.json({ status: 'error', message: 'Already logged in' });
        return;
    }

    let password = req.body.password;
    const email = req.body.email;
    const name = req.body.name;

    if (password < 8) {
        res.json({ status: 'error', message: 'Password must be at least 8 characters' });
        return;
    } else {
        password = bcrypt.hashSync(req.body.password, 10);
    }
    if (!email.includes('@')) {
        res.json({ status: 'error', message: 'Email is not valid' });
        return;
    }
    if (name.length < 2) {
        res.json({ status: 'error', message: 'Name must be at least 2 characters' });
        return;
    }

    //check if email exists
    client.query('SELECT * FROM users WHERE email = $1', [email], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length > 0) {
            res.json({ status: 'error', message: 'Email already exists' });
            return;
        }
    });

    //random number for user code (6 digits)
    let code = Math.floor(Math.random() * 900000) + 100000;

    //insert into database
    client.query('INSERT INTO users (name, email, password, code) VALUES ($1, $2, $3, $4)', [name, email, password, code], function (err, result) {
        if (err) {
            console.log(err);
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        res.json({ status: 'success', message: 'Account created successfully' });
    });

});

app.post('/addFriend', requireAuth, function (req, res) {
    const userCode = req.body.code.replace(/[^0-9]/g, '');;

    if (userCode === req.session.code) {
        res.json({ status: 'error', message: 'You cannot add yourself as a friend' });
        return;
    }
    if (isNaN(userCode)) {
        res.json({ status: 'error', message: 'Code must be numeric' });
        return;
    }
    if (userCode.length !== 6) {
        res.json({ status: 'error', message: 'Code must be 6 digits' });
        return;
    }
    //check if user exists with "code" column, if so append "code" to "friends" column of the requesting user
    client.query('SELECT name, friends, code FROM users WHERE code = $1 or id = $2 order by (case when code = $1 then 0 else 1 end)', [userCode, req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length < 2) {
            res.json({ status: 'error', message: 'User does not exist' });
            return;
        }

        const name = result.rows[0].name;
        //prevent type error
        if (!result.rows[1].friends) {
            result.rows[1].friends = [];
        }
        if (result.rows[1].friends.includes(result.rows[0].code)) {
            res.json({ status: 'info', message: 'You are already friends with ' + name });
            return;
        }

        client.query('UPDATE users SET friends = array_append(friends, $1) WHERE id = $2', [result.rows[0].code, req.session.userId], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            res.json({ status: 'success', message: 'Friend added successfully', name: name });
        });
    });
});

app.post('/deleteFriend', requireAuth, function (req, res) {
    const userCode = req.body.code.replace(/[^0-9]/g, '');;

    if (isNaN(userCode)) {
        res.json({ status: 'error', message: 'Code must be numeric' });
        return;
    }
    if (userCode.length !== 6) {
        res.json({ status: 'error', message: 'Code must be 6 digits' });
        return;
    }
    //check if user is a friend of requesting user
    client.query('SELECT friends FROM users WHERE id = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows[0].friends.includes(userCode)) {
            res.json({ status: 'error', message: 'User is not your friend' });
            return;
        }

        client.query('UPDATE users SET friends = array_remove(friends, $1) WHERE id = $2', [userCode, req.session.userId], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            res.json({ status: 'success', message: 'Friend deleted successfully' });
        });
    });
});

app.post('/timetable', requireAuth, function (req, res) {
    const timetable = req.body.timetable
    //sanitize timetable
    for (let i = 0; i < timetable.length; i++) {
        for (let j = 0; j < timetable[i].length; j++) {
            if (timetable[i][j] !== 0) {
                timetable[i][j] = 1;
            }
        }
    }

    const d1 = timetable[0];
    const d2 = timetable[1];
    const d3 = timetable[2];
    const d4 = timetable[3];
    const d5 = timetable[4];

    //check if timetable already exists in "timetable" table
    client.query('SELECT tid FROM timetable WHERE d1 = $1 and d2 = $2 and d3 = $3 and d4 = $4 and d5 = $5', [d1, d2, d3, d4, d5], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length > 0) {
            var tid = result.rows[0].tid;

            //finally, update user with the timetable id "tid"
            client.query('UPDATE users SET tid = $1 WHERE id = $2', [tid, req.session.userId], function (err, result) {
                if (err) {
                    res.json({ status: 'error', message: 'Database error' });
                    return;
                }
                res.json({ status: 'success', message: 'Timetable updated successfully' });
            });
        } else {
            //insert into "timetable" table and get the id
            client.query('INSERT INTO timetable (d1, d2, d3, d4, d5) VALUES ($1, $2, $3, $4, $5) RETURNING tid', [d1, d2, d3, d4, d5], function (err, result) {
                if (err) {
                    res.json({ status: 'error', message: 'Database error' });
                    return;
                }
                var tid = result.rows[0].tid;
                //finally, update user with the timetable id "tid"
                client.query('UPDATE users SET tid = $1 WHERE id = $2', [tid, req.session.userId], function (err, result) {
                    if (err) {
                        res.json({ status: 'error', message: 'Database error' });
                        return;
                    }
                    res.json({ status: 'success', message: 'Timetable updated successfully' });
                });
            });
        }
    });
});

app.post('/verify', function (req, res) {
    //if not logged in, error
    if (!req.session.userId) {
        res.json({ status: 'error', message: 'Not logged in' });
        return;
    }
    //if already verified, error
    client.query('SELECT verified FROM users WHERE id = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows[0].verified) {
            res.json({ status: 'error', message: 'Email already verified' });
            return;
        }
    });
    //get code from user
    const code = req.body.code.replace(/[^0-9]/g, '');
    if (isNaN(code)) {
        res.json({ status: 'error', message: 'Code must be numeric' });
        return;
    }
    //it must be 4 digits
    if (code.length !== 4) {
        res.json({ status: 'error', message: 'Code must be 4 digits' });
        return;
    }
    //check if code is correct
    client.query('SELECT code FROM otp WHERE userId = $1', [req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length === 0) {
            res.json({ status: 'error', message: 'Code does not exist' });
            return;
        }
        if (result.rows[0].code == code) {
            //update "verified" column in "users" table
            client.query('UPDATE users SET verified = true WHERE id = $1', [req.session.userId], function (err, result) {
                if (err) {
                    res.json({ status: 'error', message: 'Database error' });
                    return;
                }
                res.json({ status: 'success', message: 'Email verified successfully' });
            });
        } else {
            res.json({ status: 'error', message: 'Code is incorrect' });
        }
    });
});

app.post('/logout', function (req, res) {
    req.session.userId = null;
    res.json({ status: 'success', message: 'Logged out successfully' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, function () {
    console.log('Listening on port', PORT);
});

