const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const validator = require('email-validator');
const schedule = require('node-schedule');//used to schedule automatic emails
const nodemailer = require("nodemailer");
const zlib = require('zlib');

//used to set port to listen on
const port = 5622;

const app = express();
// Increase the maximum allowed payload size to 50MB
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Read in the contents of the secure.json file
const secureData = fs.readFileSync('secure.json');
const secure = JSON.parse(secureData);

//transporter to send emails with (for security reasons auth is held in a seperate json)
const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: secure.email.user,
        pass: secure.email.pass
    }
});



/*
 * The most important part of the code :), this tells express to listen on port 5622 of the local host
 * (our proxy will route the requests to us, if you need a refresher on that just look through the docs)
 */
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});


//return a random string of a given length using the given character set
function randomString(length, chars) {
    var result = '';
    for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

//read an email at return the year
function getEmailYear(email) {
    const yearMatch = email.match(/\d{2}(?=@peddie\.org)/);
    if (yearMatch) {
        const year = parseInt(yearMatch[0]) + 2000;
        return year;
    } else {
        return 0;
    }
}

//returns the username from email
function getUsername(email) {
    return email.substring(0, email.indexOf("@"));
}

//returns the current graduation year
function getCurrentYear() {
    const d = new Date();
    let year = d.getFullYear() + (d.getMonth() > 6 ? 1 : 0);
    return year;
}

//return the name, year, and email of all saved members
app.get('/getAllMembers', (req, res) => {
    var con = mysql.createConnection(secure.mysql);

    con.connect(function (err) {
        if (err) logError(err);
        con.query("SELECT first_name, last_name, email, year FROM members WHERE public>=1", function (err, result, fields) {
            if (err) logError(err);
            res.json({ "error": false, "message": result });
            return res.end();
        })
        con.end();
    })
});

//Returns all of a member's (public) data. (name, year, projects, articles, etc.)
app.get('/getMemberData', (req, res) => {
    email = req.query.email;
    console.log(email);
    var member;//json containing member's info

    var con = mysql.createConnection(secure.mysql);

    if (email) {
        con.connect(function (err) {
            if (err) logError(err);

            con.query(`SELECT * FROM members WHERE email = '${email}'`, function (err, result, fields) {
                if (err) logError(err);
                if (result.length > 0) {
                    member = result[0];


                    //get user's project info
                    con.query(`SELECT * FROM projects WHERE REPLACE(contributors, ' ', '') LIKE '%"email":"${email}"%'`, function (err, result, fields) {
                        if (err) logError(err);
                        for (var i = 0; i < result.length; i++) {
                            //result[i].contributors is saved as a jsonArray, but needs to be parsed (also sorted)
                            //look into new versions for MariaDB to support acutal JSON datatypes?
                            var json = JSON.parse(result[i].contributors);
                            json.contributors.sort(function (a, b) {
                                if (a.priority === undefined && b.priority === undefined) {
                                    return 0;
                                } else if (a.priority === undefined) {
                                    return 1;
                                } else if (b.priority === undefined) {
                                    return -1;
                                } else {
                                    return a.priority - b.priority;
                                }
                            });
                            result[i].contributors = json.contributors;
                        }
                        //sort projects in order of date
                        result.sort(function (a, b) {
                            var dateA = new Date(a.publish_date);
                            var dateB = new Date(b.publish_date);
                            if (dateA > dateB) {
                                return -1;
                            } else if (dateA < dateB) {
                                return 1;
                            } else {
                                return 0;
                            }
                        });
                        if (result) member.projects = result;

                        //get user's article info
                        con.query(`SELECT * FROM articles WHERE REPLACE(contributors, ' ', '') LIKE '%"email":"${email}"%'`, function (err, result, fields) {
                            if (err) logError(err);
                            for (var i = 0; i < result.length; i++) {
                                //result[i].contributors is saved as a jsonArray, but needs to be parsed (also sorted)
                                //look into new versions for MariaDB to support acutal JSON datatypes?
                                var json = JSON.parse(result[i].contributors);
                                json.contributors.sort(function (a, b) {
                                    if (a.priority === undefined && b.priority === undefined) {
                                        return 0;
                                    } else if (a.priority === undefined) {
                                        return 1;
                                    } else if (b.priority === undefined) {
                                        return -1;
                                    } else {
                                        return a.priority - b.priority;
                                    }
                                });
                                result[i].contributors = json.contributors;
                            }
                            //sort projects in order of date
                            result.sort(function (a, b) {
                                var dateA = new Date(a.publish_date);
                                var dateB = new Date(b.publish_date);
                                if (dateA > dateB) {
                                    return -1;
                                } else if (dateA < dateB) {
                                    return 1;
                                } else {
                                    return 0;
                                }
                            });
                            if (result) member.articles = result;
                            res.json(member);
                            return res.end();
                            con.end();
                        });
                    });
                } else {
                    res.json({ "message": "user not found" });
                    return res.end();
                }
            });
        });
    } else {
        res.json({ "message": "email invalid" });
        return res.end();
    }
});


// test to make sure it is working
app.get('/', (req, res) => {
    res.send('Hello World!');
});


//login with google stuff
app.post('/authenticateUser', (req, res) => {
    const token = req.body.token;

    const CLIENT_ID = secure.google.clientId;
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(CLIENT_ID);
    async function verify() {
        try {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: CLIENT_ID
            });
            const payload = ticket.getPayload();
            log(`authenticateUser\n ${payload['name']}\n ${payload['email']}\n ${payload['hd']}`);


            if (payload['hd'] != 'peddie.org') {
                res.json({ "message": "failed", "credential": payload });
                res.end();
            } else {

                //check if the user is already registered in the database
                var con = mysql.createConnection(secure.mysql);
                con.connect(function (err) {
                    if (err) logError(err);
                    con.query(`SELECT first_name, last_name, email, year, permissions FROM members WHERE email = '${payload['email']}'`, function (err, result, fields) {
                        if (err) logError(err);
                        if (result.length > 0) {
                            res.json({ "message": "success", "credential": payload, "user": result[0] });
                            res.end();
                        } else {
                            res.json({ "message": "new-user", "credential": payload });
                            res.end();
                        }
                    });
                    con.end();
                })
            }

        } catch (error) {
            console.error(error);
            res.json({ "message": "failed" });
            res.end();
        }
    }
    verify().catch(console.error);
});

//add member from google user credential
app.post('/addMember', function (req, res) {
    const token = req.body.token;

    const CLIENT_ID = secure.google.clientId;
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(CLIENT_ID);
    async function verify() {
        try {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: CLIENT_ID
            });
            const payload = ticket.getPayload();
            //check that it is a peddie user
            if (payload['hd'] != 'peddie.org') {
                res.json({ "message": "failed" });
                res.end();
            } else {
                //check if the user is already registered in the database
                var con = mysql.createConnection(secure.mysql);
                con.connect(function (err) {
                    if (err) logError(err);
                    con.query(`SELECT * FROM members WHERE email = '${payload['email']}'`, function (err, result, fields) {
                        if (err) logError(err);
                        if (result.length > 0) {
                            //the member should not already be in the database
                            res.json({ "message": "success" });
                            res.end();
                            con.end();
                        } else {
                            //add member
                            con.query(`INSERT INTO members (first_name, last_name, email, year) VALUES ('${payload['given_name']}', '${payload['family_name']}', '${payload['email']}', ${getEmailYear(payload['email'])})`, function (err, result, fields) {
                                if (err) logError(err);

                                res.json({ "message": "success" });
                                res.end();
                                con.end();
                            });
                        }
                    })

                })
            }


        } catch (error) {
            console.error(error);
            res.json({ "message": "failed" });
            res.end();
        }
    }
    verify().catch(console.error);
});

//updates the user's bio
app.post('/updateBio', (req, res) => {
    const token = req.body.token;
    const bio = req.body.bio;
    //verify credential
    verifyCredential(token, function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
        }
        else {
            console.log(email);
            var con = mysql.createConnection(secure.mysql);
            con.query(`UPDATE members SET bio="${bio}" WHERE email="${email}"`, function (err, result, fields) {
                if (err) logError(err);
                console.log(bio);
                res.json({ 'message': 'success' });
            });
        }
    });
});

//updates the user's bio
app.post('/updateUniversity', (req, res) => {
    const token = req.body.token;
    const uni = req.body.uni;
    //verify credential
    verifyCredential(token, function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
        }
        else {

            var con = mysql.createConnection(secure.mysql);
            con.query(`UPDATE members SET university="${uni}" WHERE email="${email}" AND year = ${getCurrentYear()}`, function (err, result, fields) {
                if (err) logError(err);
                // console.log(uni);
                res.json({ 'message': 'success' });
            });
        }
    });
});

//updates the user's profile visibilty
app.post('/updateVisibility', (req, res) => {
    const token = req.body.token;
    const oldVal = req.body.oldVal;
    if (oldVal != null) {
        var newVal = (oldVal <= 0 ? 1 : 0);
        //verify credential
        verifyCredential(token, function (success, email) {
            if (!success) {
                res.json({ 'message': 'failed' });
                res.end();
            }
            else {
                var con = mysql.createConnection(secure.mysql);
                con.query(`UPDATE members SET public=${newVal} WHERE email="${email}"`, function (err, result, fields) {
                    if (err) logError(err);
                    res.json({ 'message': 'success', 'newVal': newVal });
                    res.end();
                });
            }
        });
    } else {
        res.json({ 'message': 'failed' });
        res.end();
    }
});

//updates the user's profile image
app.post('/updateUserImage', (req, res) => {
    const token = req.body.token;
    const image = req.body.image;
    if (image) {

        verifyCredential(token, function (success, email) {
            if (!success) {
                res.json({ 'message': 'failed' });
                res.end();
            }
            else {
                const username = getUsername(email);
                const buffer = Buffer.from(image, 'base64');
                // Write the buffer to a file
                fs.writeFile(`../members/user-images/${username}`, buffer, function (err) {
                    if (err) {
                        console.log(err);
                        res.send({ error: 'true', message: 'Failed To Save Image' });
                    } else {
                        console.log(`Image saved as ${username}`);
                    }
                });
            }
        });
    }
});

//deletes a user's account
app.post('/deleteUser', (req, res) => {
    const token = req.body.token;
    verifyCredential(token, function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);
            con.query(`DELETE FROM members WHERE email="${email}"`, function (err, result, fields) {
                if (err) logError(err);
                console.log('Deleted user ' + email);
                res.json({ 'message': 'success' });
                res.end();
            });
        }
    });
});


//admin tools
//return all member data
app.get('/admin/getAllMembers', (req, res) => {
    const token = req.query.token;
    verifyCredentialPermission(token, 'admin', function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);

            con.connect(function (err) {
                if (err) logError(err);
                con.query("SELECT * FROM members", function (err, result, fields) {
                    if (err) logError(err);
                    res.json({ "error": false, "message": result });
                    return res.end();
                })
                con.end();
            })
        }
    });
});

//updates a users profile info
app.post('/admin/updateUserProfile', (req, res) => {
    const token = req.body.token;
    const userEmail = req.body.email;
    const bio = req.body.bio;
    const university = req.body.university;
    const public = req.body.public;

    verifyCredentialPermission(token, 'admin', function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);

            con.connect(function (err) {
                if (err) logError(err);
                con.query(`UPDATE members SET public=${public}, bio="${bio}", university="${university}" WHERE email="${userEmail}"`, function (err, result, fields) {
                    if (err) logError(err);
                    res.json({ "message": "success" });
                    return res.end();
                });
                con.end();
            })
        }
    });
});

//updates the user's profile image
app.post('/admin/updateUserImage', (req, res) => {
    const token = req.body.token;
    const userEmail = req.body.email;
    const image = req.body.image;
    if (image) {

        verifyCredentialPermission(token, "admin", function (success, email) {
            if (!success) {
                res.json({ 'message': 'failed' });
                res.end();
            }
            else {
                const username = getUsername(userEmail);
                const buffer = Buffer.from(image, 'base64');
                // Write the buffer to a file
                fs.writeFile(`../members/user-images/${username}`, buffer, function (err) {
                    if (err) {
                        console.log(err);
                        res.send({ error: 'true', message: 'Failed To Save Image' });
                    } else {
                        console.log(`Image saved as ${username}`);
                    }
                });
            }
        });
    }
});

//removes permission from member
app.post('/admin/permissions/remove', (req, res) => {
    const token = req.body.token;
    const userEmail = req.body.email;
    const perm = req.body.permission;

    verifyCredentialPermission(token, "admin", function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);

            con.connect(function (err) {
                if (err) logError(err);
                con.query(`SELECT permissions FROM members WHERE email="${userEmail}"`, function (err, result, fields) {
                    //get current permissions
                    if (err) logError(err);
                    if (result[0].permissions.includes(perm)) {
                        let permArr = result[0].permissions.split(",");
                        for (let i = permArr.length - 1; i >= 0; i--) {
                            if (permArr[i] == perm) {
                                permArr.splice(i, 1);
                            }
                        }
                        con.query(`UPDATE members SET permissions="${permArr.join(',')}" WHERE email="${userEmail}"`, function (err, result, fields) {
                            //update with new permissions
                            if (err) logError(err);
                            res.json({ "error": false, "message": "success" });
                            return res.end();
                        });
                        con.end();
                    }
                    else con.end();
                })
            })
        }
    });
});
app.post('/admin/permissions/add', (req, res) => {
    const token = req.body.token;
    const userEmail = req.body.email;
    const perm = req.body.permission;

    verifyCredentialPermission(token, "admin", function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);

            con.connect(function (err) {
                if (err) logError(err);
                con.query(`SELECT permissions FROM members WHERE email="${userEmail}"`, function (err, result, fields) {
                    //get current permissions
                    if (err) logError(err);
                    if (!result[0].permissions.includes(perm)) {
                        let permArr = result[0].permissions.split(",");
                        permArr.push(perm);
                        con.query(`UPDATE members SET permissions="${permArr.join(',')}" WHERE email="${userEmail}"`, function (err, result, fields) {
                            //update with new permissions
                            if (err) logError(err);
                            res.json({ "error": false, "message": "success" });
                            return res.end();
                        });
                        con.end();
                    }
                    else con.end();
                })
            })
        }
    });
});



//cs fellows
//schedules a cs fellow for a specific time slot
app.post('/csfellows/schedule', (req, res) => {
    const token = req.body.token;
    const name = req.body.name;
    const date = new Date(req.body.date);
    const duration = req.body.duration;
    const location = req.body.location;

    verifyCredentialPermission(token, 'csfellow', function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);

            con.connect(function (err) {
                if (err) logError(err);
                const mysqlDate = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + (date.getDate()) + ' ' + (date.getUTCHours()) + ':' + (date.getUTCMinutes()) + ':00';
                con.query(`INSERT INTO csfellows (name, email, date, duration, location) VALUES ('${name}', '${email}', '${mysqlDate}', ${duration}, '${location}');`, function (err, result, fields) {
                    if (err) logError(err);
                    res.json({ "message": "success", "id": result.insertId });
                    return res.end();
                });
                con.end();
            })
        }
    });
});

//gets the cs fellow for a specific month
app.get('/csfellows/schedule', (req, res) => {
    const date = new Date(req.query.date);

    var con = mysql.createConnection(secure.mysql);
    con.connect(function (err) {
        if (err) logError(err);
        // console.log(`SELECT name, email, date, duration, id FROM csfellows WHERE MONTH(date)=${date.getMonth() + 1}`);
        con.query(`SELECT name, email, date, duration, location, id FROM csfellows WHERE YEAR(date)=${date.getFullYear()} AND MONTH(date)=${date.getMonth() + 1}`, function (err, result, fields) {
            if (err) logError(err);
            result.sort(function (a, b) {
                return a.date - b.date;
            });
            res.json({ "message": "success", "schedule": result });
            return res.end();
        });
        con.end();
    });
});

//gets the cs fellows for a specific day
app.get('/csfellows/schedule/day', (req, res) => {
    const date = new Date(req.query.date);
    const mysqlDate = date.getFullYear() + '-' + date.getMonth() + '-' + (date.getDate() + 1) + ' ' + date.getHours() + ':00:00';

    var con = mysql.createConnection(secure.mysql);
    con.connect(function (err) {
        if (err) logError(err);
        // console.log(`SELECT name, email, date, duration, id FROM csfellows WHERE MONTH(date)=${date.getMonth() + 1}`);
        con.query(`SELECT name, email, date, duration, location, id FROM csfellows WHERE YEAR(date)=${date.getFullYear()} AND MONTH(date)=${date.getMonth() + 1} AND DAY(date)=${date.getDate()}`, function (err, result, fields) {
            if (err) logError(err);
            result.sort(function (a, b) {
                return a.date - b.date;
            });
            res.json({ "message": "success", "schedule": result });
            return res.end();
        });
        con.end();
    });
});

//removes an event from the calendar
app.post('/csfellows/schedule/cancel', (req, res) => {
    const token = req.body.token;
    const id = req.body.id;

    verifyCredentialPermission(token, 'csfellow', function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            var con = mysql.createConnection(secure.mysql);

            //var dateString = 
            con.connect(function (err) {
                if (err) logError(err);
                //INSERT INTO csfellows (name, email, datetime) VALUES ('test', '${email}', '2023-05-17 20:00:00');
                console.log(`DELETE FROM csfellows WHERE email='${email}' AND id=${id}`)
                con.query(`DELETE FROM csfellows WHERE email='${email}' AND id=${id}`, function (err, result, fields) {
                    if (err) logError(err);
                    res.json({ "message": "success" });
                    return res.end();
                });
                con.end();
            })
        }
    });
});

function scheduleFellowsReminder() {
    console.log("Creating schedule...")
    const job = schedule.scheduleJob('0 * * * *', function () {
        // console.log("Job run at " + new Date());
        emailFellowsReminder();
    })
    const weekly = schedule.scheduleJob('0 12 * * * 1', function () {
        //emailFellowsWeekly();
    })
}

function emailFellowsReminder() {
    //set date as eastern time (complicated b/c of daylight savings)
    const date = new Date();
    const localeString = date.toLocaleString('en-US', { timeZoneName: 'short', timeZone: 'America/New_York' });
    const dateET = new Date(localeString.substring(0, localeString.lastIndexOf(' '))); //detect ex. 2:43:18 PM EST
    // const date2 = new Date(date.getTime() - etOffsetMinutes * 60000);
    // console.log('Original Date (UTC):', date.toISOString());
    // console.log('Converted Date (ET):', date2.toISOString());

    //get all csfellows on the day
    var con = mysql.createConnection(secure.mysql);
    con.connect(function (err) {
        if (err) logError(err);
        // console.log(`SELECT name, email, date, duration, id FROM csfellows WHERE MONTH(date)=${date.getMonth() + 1}`);
        con.query(`SELECT name, email, date, duration, location, id FROM csfellows WHERE YEAR(date)=${dateET.getFullYear()} AND MONTH(date)=${dateET.getMonth() + 1} AND DAY(date)=${dateET.getDate()} AND reminder=1`, function (err, result, fields) {
            if (err) logError(err);
            // console.log(result);
            for (let i = result.length - 1; i >= 0; i--) {
                var fellow = result[i]
                var fellowDate = new Date(fellow.date);
                console.log(fellow.name, fellow.id, fellowDate, dateET, fellowDate - dateET, fellowDate - dateET < 3 * 3600000)
                if (dateET > fellowDate || fellowDate - dateET > 3 * 3600000) {
                    result.splice(i, 1);
                    console.log(result.length);
                }
            }

            for (let i = 0; i < result.length; i++) {
                let mailOptions = {
                    from: secure.email.user,
                    to: result[i].email,
                    subject: 'CS Fellows',
                    text: '',
                    html: `<p>You are scheduled for CS Fellows Today!</p>
                            <h3>${result[i].location}, ${new Date(result[i].date).toLocaleTimeString('en-US', { timeStyle: 'short' })}</h3>`
                };
                transport.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.log(error);
                    }
                    console.log('Message sent: ', info.messageId, result[i].id);
                });

            }

            if (result.length > 0) {
                let query = "id=" + result[0].id;
                for (let i = 1; i < result.length; i++) {
                    query += " OR id=" + result[i].id;
                }

                con.query(`UPDATE csfellows SET reminder=-1 WHERE ${query}`, function (err, result, fields) {
                    if (err) logError(err);
                    console.log(result);
                    con.end();
                });
            } else {
                con.end();
            }
        });
    });
}
/*
emailFellowsWeekly();
function emailFellowsWeekly() {
/*    const date = new Date();

    var con = mysql.createConnection(secure.mysql);
    con.connect(function (err) {
        if (err) logError(err);
        // console.log(`SELECT name, email, date, duration, id FROM csfellows WHERE MONTH(date)=${date.getMonth() + 1}`);
        con.query(`SELECT name, email, date, duration, location, id FROM csfellows WHERE YEAR(date)=${date.getFullYear()} AND MONTH(date)=${date.getMonth() + 1}`, function (err, result, fields) {
            if (err) logError(err);
            result.sort(function (a, b) {
                return a.date - b.date;
            });
            let fellows = result;
            if (result.length > 0) {
                console.log(fellows);
                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                let list = [];

                fs.readFile('../csfellows/schedule.json', 'utf-8', (err, data) => {
                    if (err) {
                        console.error('Error reading schedule file:', err.message);
                        return;
                    }
                    let schedule = JSON.parse(data).schedule;

                    for (let i = 0; i < dayNames.length; i++) {
                        if (i == 0 && schedule["Sunday"].length == 0) i++;
                        // console.log(schedule[dayNames[i]]);
                        list[dayNames[i]] = [];
                    }

                    let times = [];
                    for (let j = 0; j < fellows.length; j++) {
                        let fellow = fellows[j];
                        let time = fellow.date;
                        if (time.getDay() == i) {
                            timeMin = time.getHours() * 60 + time.getMinutes();
                            if (times[timeMin]) times[timeMin]++;
                            else {
                                times[timeMin] = 1;

                                let hour = time.getHours() % 12;
                                let minute = time.getMinutes();
                                time.setMinutes(time.getMinutes() + fellow.duration);
                                let hour2 = time.getHours() % 12;
                                let minute2 = time.getMinutes();
                                list[dayNames[i]].append(`<p>${(hour) + ':' + (minute < 10 ? '0' : '') + minute + '-' + (hour2) + ':' + (minute2 < 10 ? '0' : '') + minute2}  ${time.getHours() < 12 ? 'AM' : 'PM'}</p>`);
                                // console.log(fellow.email, hour, minute, hour2, minute2);
                            }
                            list[dayNames[i]].append(`<div class="event" style="background-color:${stringToColor(fellow.email)}; border-color:#00000000">${fellow.name}</div>`);
                            // item.innerHTML += 
                        }
                    }
                    console.log("List\n"+list);
                });

            }
            else con.end();
        });
    });
}*/

/*
//fills in an entire month of events DEBUG ONLY
app.post('/csfellows/schedule/month', (req, res) => {
    const token = req.body.token;
    const schedule = req.body.schedule;

    verifyCredentialPermission(token, 'admin', function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {

            recursiveAdd(schedule, 0, 0);

            // for (let i = 0; i < schedule.length; i++) {
            //     for (let j = 0; j < schedule[i].length; j++) {



            //         var event = schedule[i][j];

            //         const date = new Date(event.date);
            //         const mysqlDate = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + (i + 1) + ' ' + date.getHours() + ':00:00';
            //         con.connect(function (err) {
            //             if (err) logError(err);
            //             con.query(`INSERT INTO csfellows (name, email, date) VALUES ('${event.name}', '${event.email}', '${mysqlDate}');`, function (err, result, fields) {
            //                 if (err) logError(err);
            //                 console.log(i, j, schedule[i][j]);
            //                 con.end();
            //             });
            //         });
            //     }
            // }
        }
    });
});
//recursivly add events to the schedule
function recursiveAdd(schedule, i, j) {
    console.log(i, j)

    var con = mysql.createConnection(secure.mysql);

    var event = schedule[i][j];
    const date = new Date(event.date);
    const mysqlDate = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + (i + 1) + ' ' + (j % 2 == 0 ? '20' : '21') + ':00:00';

    con.connect(function (err) {
        if (err) logError(err);
        con.query(`INSERT INTO csfellows (name, email, date) VALUES ('${event.name}', '${event.email}', '${mysqlDate}');`, function (err, result, fields) {
            if (err) logError(err);
            console.log(i, j, schedule[i][j]);

            j = (j + 1) % schedule[i].length;
            if (j == 0) i++;
            if (i < schedule.length) { con.end(); setTimeout(() => { recursiveAdd(schedule, i, j); }, 100); }
            else con.end();
        });
    });
}
*/

//events
//gets the cs fellow for a specific month
app.get('/events/schedule', (req, res) => {
    const date = new Date(req.query.date);
    const mysqlDate = date.getFullYear() + '-' + date.getMonth() + '-' + (date.getDate() + 1) + ' ' + date.getHours() + ':00:00';

    var con = mysql.createConnection(secure.mysql);
    con.connect(function (err) {
        if (err) logError(err);
        // console.log(`SELECT name, date, id FROM events WHERE MONTH(date)=${date.getMonth() + 1}`);
        con.query(`SELECT event, date, id, club FROM events WHERE YEAR(date)=${date.getFullYear()} AND MONTH(date)=${date.getMonth() + 1}`, function (err, result, fields) {
            if (err) logError(err);
            result.sort(function (a, b) {
                return a.date - b.date;
            });
            res.json({ "message": "success", "schedule": result });
            return res.end();
        });
        con.end();
    });
});

//get zoom link
app.get('/csfellows/getZoomLink', (req, res) => {
    const token = req.query.token;
    verifyCredentialPermission(token, 'csfellow', function (success, email) {
        if (!success) {
            res.json({ 'message': 'failed' });
            res.end();
        }
        else {
            res.json({ 'message': 'success', 'link': secure.zoom.link });
            res.end();
        }
    });
});

//verify user credential and callbacks with email
function verifyCredential(token, callback) {
    const CLIENT_ID = secure.google.clientId;
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(CLIENT_ID);
    async function verify() {
        try {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: CLIENT_ID
            });
            const payload = ticket.getPayload();

            if (payload['hd'] != 'peddie.org') {
                callback(false);
            } else {
                //check if the user is already registered in the database
                var con = mysql.createConnection(secure.mysql);
                con.connect(function (err) {
                    if (err) logError(err);
                    con.query(`SELECT email FROM members WHERE email = '${payload['email']}'`, function (err, result, fields) {
                        if (err) logError(err);
                        if (result.length > 0) {
                            callback(true, payload['email']);
                        } else {
                            callback(false);
                        }
                    });
                    con.end();
                })
            }

        } catch (error) {
            console.error(error);
            callback(false);
        }
    }
    verify().catch(console.error);
}

//verifys admin credential & if a user has a specific permission
function verifyCredentialPermission(token, permission, callback) {
    const CLIENT_ID = secure.google.clientId;
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(CLIENT_ID);
    async function verify() {
        try {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: CLIENT_ID
            });
            const payload = ticket.getPayload();

            if (payload['hd'] != 'peddie.org') {
                callback(false);
            } else {
                //check if the user is already registered in the database
                var con = mysql.createConnection(secure.mysql);
                con.connect(function (err) {
                    if (err) logError(err);
                    con.query(`SELECT email FROM members WHERE email = '${payload['email']}' AND FIND_IN_SET('${permission}', permissions) > 0`, function (err, result, fields) {
                        if (err) logError(err);
                        if (result.length > 0) {
                            callback(true, payload['email']);
                        } else {
                            callback(false);
                        }
                    });
                    con.end();
                })
            }

        } catch (error) {
            console.error(error);
            callback(false);
        }
    }
    verify().catch(console.error);
}




//Logging functions
function logError(error) {
    console.error(error);
    // Get the current timestamp
    const timestamp = new Date().toISOString();

    // Format the log entry
    const logEntry = `\n${timestamp}\n${error}\n`;

    // Specify the path to the log file
    const logFilePath = path.join(__dirname, 'error.log');

    // Append the log entry to the file
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            // Handle the error, e.g., log it to the console
            console.error(`Error appending to log file: ${err.message}`);
        } else {
            //   console.log('Error logged successfully.');
        }
    });
}

function log(msg) {
    console.log(msg);
    const timestamp = new Date().toISOString();
    const logEntry = `\n${timestamp}\n${msg}\n`;
    const logFilePath = path.join(__dirname, 'console.log');
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error(`Error appending to log file: ${err.message}`);
        } else {
        }
    });
}

function compressLogFile(filename) {
    // Specify the paths for the original and compressed log files
    const originalLogFilePath = path.join(__dirname, filename);
    const compressedLogFilePath = path.join(__dirname, 'log', filename + '.gz');

    // Create a read stream from the original log file
    const readStream = fs.createReadStream(originalLogFilePath);

    // Create a write stream for the compressed log file
    const writeStream = fs.createWriteStream(compressedLogFilePath);

    // Create a gzip transform stream
    const gzip = zlib.createGzip();

    // Pipe the read stream through the gzip stream and then to the write stream
    readStream.pipe(gzip).pipe(writeStream);

    // Handle events when the compression is complete
    writeStream.on('close', () => {
        // Remove the original log file
        fs.unlinkSync(originalLogFilePath);

        //empty original log file
        fs.writeFileSync(originalLogFilePath, '');

        console.log('Log file compressed and saved successfully.');
    });

    // Handle errors during the compression process
    writeStream.on('error', (err) => {
        console.error(`Error compressing log file: ${err.message}`);
    });
}

// compressLogFile('console.log');


//Just some nice color hashing :)
function stringToColor(text) {
    var hash = stringToHash(text);
    let r = 127 + ((hash & 0xFF0000) >> 16) / 2;
    let g = 127 + ((hash & 0x00FF00) >> 8) / 2;
    let b = 127 + ((hash & 0x0000FF)) / 2;

    //println(hash,r,g,b);
    return `rgb(${r},${g},${b})`;
}

function stringToHash(string) {
    var hash = 0;
    if (string.length == 0) return hash;
    for (i = 0; i < string.length; i++) {
        char = string.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}