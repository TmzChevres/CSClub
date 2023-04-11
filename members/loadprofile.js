const urlParams = new URLSearchParams(window.location.search);
const username = urlParams.get('user');
const email = username + '@peddie.org';

getMember(email);

//requests user data from the MySQL database
function getMember(email) {
    if (window.jQuery) {
        $.get("https://peddiecs.peddie.org/nodejs/getMemberData", {
            "email": email
        }, function (res) {
            if (res.message == "failed") {
                console.log("Failed to get member data")
            } else {
                console.log(res);
                displayMemberProfile(res);
            }
        });
    }
}

function displayMemberProfile(json) {
    var name = json.first_name + " " + json.last_name;
    console.log("Loading data for " + name);

    //add user display-icon
    var img = document.getElementById('image');
    img.src = 'user-images/' + username;
    img.addEventListener('error', function () {img.src = 'user-images/missing.jpg';});
    document.getElementById('name').innerText = name + (json.year != '0' ? (" '" + json.year.toString().slice(-2)) : '');
    document.getElementById('info').innerHTML += `<li>${email}</li>` + (json.university ? `<li>${json.university}</li>` : '');

    //center icon if no bio
    if (json.bio || json.groups) {
        document.getElementById('icon').style = "grid-column:1";
        //add bio
        if (json.bio) {
            document.getElementById('bio').innerHTML = `<h3>Bio</h3><p>${json.bio}</p>`
        }
        //add groups (not a thing yet)
        if (json.groups) {
            document.getElementById('groups').innerHTML = `<h3>Club Groups</h3><p>${json.groups}</p>`
        }
    }
}