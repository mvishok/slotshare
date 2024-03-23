const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
dotenv.config();

const sendOtp = require('./mail');
const sendRSVP = require('./mail');
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
            client.query('UPDATE otp SET code = $1 WHERE userId = $2', [code, req.session.userId], function (err) {
                if (err) {
                    res.json({ status: 'error', message: 'Database error' });
                    return;
                }
            });
        } else {
            client.query('INSERT INTO otp (userId, code) VALUES ($1, $2)', [req.session.userId, code], function (err) {
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

app.get('/rsvp', requireAuth, async function (req, res) {
    //get rsvp id from url, get opt from url
    // https://slotshare.vishok.tech/rsvp?id=1&opt=yes
    const id = req.query.id;
    const opt = req.query.opt;

    //if id or opt is empty, error
    if (!id || !opt) {
        res.json({ status: 'error', message: 'Invalid request' });
        return;
    }

    //if opt is not yes or no, error
    if (opt !== 'yes' && opt !== 'no') {
        res.json({ status: 'error', message: 'Invalid request' });
        return;
    }

    //make sure the event exists
    client.query('SELECT * FROM events WHERE eid = $1', [id], async function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length === 0) {
            res.json({ status: 'error', message: 'Event does not exist' });
            return;
        }

        //get userCode from database without callback hell
        const userCodeResult = await client.query('SELECT code FROM users WHERE id = $1', [req.session.userId]);
        if (userCodeResult.rows.length === 0) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        const userCode = userCodeResult.rows[0].code;

        //make sure the user is invited to the event without callback hell
        const isInvited = client.query('SELECT invitees FROM events WHERE eid = $1', [id], function (err, result) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            if (result.rows.length === 0) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            let invited = false;
            for (let i = 0; i < result.rows[0].invitees.length; i++) {
                if (result.rows[0].invitees[i][0] === userCode) {
                    invited = true;
                    break;
                }
            }
            //if not invited, error
            if (!invited) {
                res.json({ status: 'error', message: 'You are not invited to this event' });
                return;
            }
        });

        const inviteesResult = await client.query('SELECT invitees FROM events WHERE eid = $1', [id]);
        if (inviteesResult.rows.length === 0) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        const invitees = inviteesResult.rows[0].invitees;
        for (let i = 0; i < invitees.length; i++) {
            if (invitees[i][0] === userCode) {
                invitees[i][1] = opt === 'yes' ? 1 : 2;
                break;
            }
        }
        //update the invitees
        //make sure invitees is a string, not an array of arrays
        client.query('UPDATE events SET invitees = $1 WHERE eid = $2', [JSON.stringify(invitees), id], function (err) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            
            res.redirect('/events');
        });
       
    });
});

app.get('/events', requireAuth, async function (req, res) {
    const userResult = await client.query('SELECT code FROM users WHERE id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
        return res.json({ status: 'error', message: 'User not found' });
    }
    const userCode = userResult.rows[0]['code'];

    //get all events where the current user is the creator OR is invited. invitees array contains the user code and the rsvp status. array of arrays, so check accordingly
    client.query('SELECT * FROM events WHERE (creator = $1 OR $2 = ANY(SELECT (jsonb_array_elements(invitees)->>0)::integer)) AND done = false;', [req.session.userId, userCode], async function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }

        //create an array of events
        const finalEvents = [];

        //insert each event into the array; but have only d, s, name, venue, description.
        //also have invitees with their rsvp status
        for (const row of result.rows) {
            const event = {
                id: row.eid,
                d: row.d,
                s: row.s,
                name: row.name,
                venue: row.venue,
                description: row.description,
                invitees: [],
                owner: false,
                rsvp: 0
            };
            //if event is not created by the current user, dont show invitees
            if (row.creator === req.session.userId) {
                for (const invitee of row.invitees) {
                    //get the name of the invitee
                    const nameResult = await client.query('SELECT name FROM users WHERE code = $1', [invitee[0]]);
                    if (nameResult.rows.length === 0) {
                        var name = 'Unknown';
                    } else {
                        name = nameResult.rows[0].name;
                    }
                    event.invitees.push({ name: name, rsvp: invitee[1] });
                }
                event.owner = true;
                finalEvents.push(event);

            } else {
                //check current user's rsvp status
                for (const invitee of row.invitees) {
                    if (invitee[0] === userCode) {
                        event.rsvp = invitee[1];
                        break;
                    }
                }
                finalEvents.push(event);
            }
        }
        
        res.render('events', { events: finalEvents });
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
    client.query('INSERT INTO users (name, email, password, code) VALUES ($1, $2, $3, $4)', [name, email, password, code], function (err) {
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

        client.query('UPDATE users SET friends = array_append(friends, $1) WHERE id = $2', [result.rows[0].code, req.session.userId], function (err) {
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

        client.query('UPDATE users SET friends = array_remove(friends, $1) WHERE id = $2', [userCode, req.session.userId], function (err) {
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
            client.query('UPDATE users SET tid = $1 WHERE id = $2', [tid, req.session.userId], function (err) {
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
                client.query('UPDATE users SET tid = $1 WHERE id = $2', [tid, req.session.userId], function (err) {
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
            client.query('UPDATE users SET verified = true WHERE id = $1', [req.session.userId], function (err) {
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

app.post("/slot", requireAuth, async function (req, res) {
    //get the slot and day from request. findout who is free at that time and day, return the names with boolean value like {name: friendname, free: true} OF CURRENT USER
    const slot = req.body.slot;
    const day = req.body.day;
    //get all friends of the current user, get their tids, get their timetables, check if they are free at that time and day, individually and append to an array
    let freeFriends = [];

    const friendsResult = await client.query('SELECT friends FROM users WHERE id = $1', [req.session.userId]);

    if (friendsResult.rows.length === 0) {
        friendsResult = { rows: [{}] };
    }
    const friends = friendsResult.rows[0].friends;

    const tidsResult = await client.query('SELECT DISTINCT tid FROM users WHERE code = ANY($1)', [friends]);
    const tids = tidsResult.rows.map(row => row.tid);

    //now we have tids of all friends. get their timetables, and check if time and day is free for that tid. if it is free, append all friends with that tid to freeFriends array
    for (const tid of tids) {
        const friendTimetableResult = await client.query('SELECT d1, d2, d3, d4, d5 FROM timetable WHERE tid = $1', [tid]);
        if (friendTimetableResult.rows.length > 0) {
            const friendTimetable = friendTimetableResult.rows[0];
            //if the slot is free for that day and time, find all names of that tid and append to freeFriends array, make sure to exclude the current user and make sure if he is friends with the current user
            //else if he is not free, append the name with false
            const friendNameResult = await client.query('SELECT name,code FROM users WHERE tid = $1 AND id != $2 AND code = ANY($3)', [tid, req.session.userId, friends]);
            if (friendNameResult.rows.length > 0) {
                if (friendTimetable["d"+day][slot] === 0) {
                    for (const row of friendNameResult.rows) {
                        freeFriends.push({ name: row.name, code: row.code, free: true });
                    }
                } else {
                    for (const row of friendNameResult.rows) {
                        freeFriends.push({ name: row.name, code: row.code, free: false });
                    }
                }   
            }
        }
    }

    
    res.json({ status: 'success', friends: freeFriends });

});

app.post('/book', requireAuth, async function (req, res) {
    //get day slot name venue description and friends [int array] from request
    const day = req.body.day;
    const slot = req.body.slot;
    const name = req.body.name;
    const venue = req.body.venue;
    const description = req.body.description;
    var friends = req.body.friends;

    //if any of the values are empty, error
    if (!day || !slot || !name || !venue || !description || !friends) {
        res.json({ status: 'error', message: 'All fields are required' });
        return;
    }

    //make sure all friends in "friends" array are actually friends of the current user
    const friendsResult = await client.query('SELECT friends FROM users WHERE id = $1', [req.session.userId]);
    if (friendsResult.rows.length === 0) {
        friendsResult = { rows: [{}] };
    }
    const friendsArray = friendsResult.rows[0].friends;
    for (const friend of friends) {
        if (!friendsArray.includes(friend)) {
            res.json({ status: 'error', message: 'One or more friends are not valid' });
            return;
        }
    }

    //get current user's name
    const userResult = await client.query('SELECT name FROM users WHERE id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
        res.json({ status: 'error', message: 'User not found' });
        return;
    }
    const userName = userResult.rows[0].name;
    //insert into events table
    //friends should be an array of arrays, each array containing the friend code and the rsvp status (0 for not rsvped, 1 for yes, 2 for no)
    friends = friends.map(friend => [friend, 0]);

    client.query('INSERT INTO events (name, d, s, description, venue, invitees, creator, done) VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING eid', [name, day, slot, description, venue, JSON.stringify(friends), req.session.userId], function (err,result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        //get event id from last insert
        const eid = result.rows[0].eid;

        //get email of each friend and send an email to them (for rsvp)
        client.query('SELECT name, email FROM users WHERE code = ANY($1)', [friends], function (err, r) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            for (const row of r.rows) {
                //(name, email, event, d, s, description, venue, creator)
                sendRSVP(row.name, row.email, name, day, slot, description, venue, userName, eid);
            }
        });
        res.json({ status: 'success', message: 'Event created successfully' });
    });
});

app.get('/complete', requireAuth, function (req, res) {
    //get the event id from get parameter
    const id = req.query.id;
    //if id is empty, error
    if (!id) {
        res.json({ status: 'error', message: 'Invalid request' });
        return;
    }
    //make sure the event exists
    client.query('SELECT * FROM events WHERE eid = $1 AND creator = $2', [id, req.session.userId], function (err, result) {
        if (err) {
            res.json({ status: 'error', message: 'Database error' });
            return;
        }
        if (result.rows.length === 0) {
            res.json({ status: 'error', message: 'Event does not exist' });
            return;
        }
        //make sure the user is the creator of the event
        if (result.rows[0].creator !== req.session.userId) {
            res.json({ status: 'error', message: 'You are not the creator of this event' });
            return;
        }
        //update the event with "done" column as true
        client.query('UPDATE events SET done = true WHERE eid = $1', [id], function (err) {
            if (err) {
                res.json({ status: 'error', message: 'Database error' });
                return;
            }
            res.redirect('/events');
        });
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

