const localVideoElement = document.querySelector('video#localVideo');
const remoteVideoElement = document.querySelector('video#remoteVideo');

const audioInputSelect = document.querySelector('select#audioSource');
const videoSelect = document.querySelector('select#videoSource');

const startButton = document.getElementById("startButton")
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');

// get mediaStream: https://github.com/webrtc/samples/tree/gh-pages/src/content/devices/input-output
function gotDevices(devices) {
    for (let i = 0; i !== devices.length; ++i) {
        const deviceInfo = devices[i];
        const option = document.createElement('option');
        option.value = deviceInfo.deviceId;
        console.log(option.value)
        if (deviceInfo.kind === 'audioinput') {
            option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1}`;
            audioInputSelect.appendChild(option);
        } else if (deviceInfo.kind === 'videoinput') {
            option.text = deviceInfo.label || `camera ${videoSelect.length + 1}`;
            videoSelect.appendChild(option);
        } else {
            console.log('Some other kind of source/device: ', deviceInfo);
        }
    }
}

// set stream for local video element
function gotStream(stream) {
    console.log(`localVideoStream: ${stream}`)
    localVideoElement.srcObject = stream;
    // TODO: RTCPeerConnection addStream / add stream
    // need to re-negotiate SDPs
    if (peersReady) callButton.disabled = false;
    // Refresh button list in case labels have become available
    // return navigator.mediaDevices.enumerateDevices();
}

// join room at start
function start() {
    enableAudio = document.getElementById('audio').checked;
    enableVideo = document.getElementById('video').checked;
    roomName = document.getElementById('roomname').value;
    userName = document.getElementById('username').value;
    socket.emit('create or join', roomName, userName);
    // password = document.getElementById('password').value;
    if (window.stream) {
        window.stream.getTracks().forEach(track => {
            track.stop();
        });
    }
    const audioSource = audioInputSelect.value;
    const videoSource = videoSelect.value;

    const constraints = {};
    if (enableAudio) {
        constraints["audio"] = { deviceId: audioSource ? { exact: audioSource } : undefined };
    }
    if (enableVideo) {
        constraints["video"] = { deviceId: videoSource ? { exact: videoSource } : undefined };
    }
    return navigator.mediaDevices.getUserMedia(constraints).then(gotStream, (err) => {
        console.log("failed to get user media, error occurred", err);
    });
}

// 1. create RTCPeerConnection for each end, add local stream
// 2. get and share with the other your ICE candidates.
// 3. get and share local descriptions (metadata about local media in SDP format)

let servers = {
    iceServers: [
        {
            url: "stun:stun.stunprotocol.org:3478"
        }
    ]
}
let pc = null;

function handleConnection(event) {
    // let server relay this candidate info to other peer
    console.log("candidate event:", event)
    if (event.candidate) {
        socket.emit("message", roomName, {
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate
        });
    } else {
        console.log('End of candidates.');
    }
}

function gotRemoteStream(e) {
    console.log("remote got stream", e.stream)
    remoteVideoElement.srcObject = e.stream;
    startButton.disabled = true;
    callButton.disabled = true;
    hangupButton.disabled = false;
}

function initPeerConnection() {
    // get iceCandidates from stun/turn servers
    pc = new RTCPeerConnection(servers);
    pc.onicecandidate = handleConnection;
    // remote peer added stream
    pc.onaddstream = gotRemoteStream;
    // TODO: remote peer removed stream
    // pc.onremovestream
    pc.addStream(localVideoElement.srcObject);
}

function setLocalAndSendSDP(desc) {
    pc.setLocalDescription(desc).then(
        function() {
            console.log("local description for local set.");
        }
    );
    socket.emit("message", roomName, desc);
}

// create connection and exchange sdp
// use socketio to send (candidates + sdp) to the other peer
function call() {
    startButton.disabled = true;
    callButton.disabled = true;
    hangupButton.disabled = false;

    initPeerConnection();
    pc.createOffer(
        {
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1
        }
    ).then(setLocalAndSendSDP);
}


function hangup() {
    pc.close();
    pc = null;
    callButton.disabled = false;
    hangupButton.disabled = true;
    socket.emit("message", roomName, "bye");
}

// get a socket connection
const socket = io();

socket.on('created', function(roomName, userName) {
    console.log(`${userName} Created room ${roomName}`);
});

socket.on('full', function(roomName) {
    alert(`room ${roomName} is full!`);
});

socket.on('joined', function(roomName, userName) {
    console.log(`${userName} joined room ${roomName}`);
});

socket.on("countUpdated", (count) => {
    console.log(`Welcome! There're currently ${count} users connected.`)
})

let peersReady = false;
socket.on("ready", () => {
    console.log("peer is ready, you can start the call now.")
    // now we have peers joined the same room
    peersReady = true;
    // local stream also ready
    if (localVideoElement.srcObject) {
        callButton.disabled = false;
    }
})

socket.on("message", (message) => {
    if (message === "bye") {
        console.log("remote peer hungup!");
        hangup();
    } else if (message.type === "candidate") {
        var candidate = new RTCIceCandidate({
            sdpMLineIndex: message.label,
            candidate: message.candidate
        });
        if (!pc) {
            initPeerConnection();
        }
        pc.addIceCandidate(candidate);
    } else if (message.type === "offer") {
        if (!pc) {
            initPeerConnection();
        }
        pc.setRemoteDescription(new RTCSessionDescription(message));
        pc.createAnswer().then(setLocalAndSendSDP);
    } else if (message.type === "answer") {
        pc.setRemoteDescription(new RTCSessionDescription(message));
    }
});

videoSelect.onchange = start;
audioInputSelect.onchange = start;
startButton.onclick = () => {
    start();
    navigator.mediaDevices.enumerateDevices().then(gotDevices);
}
callButton.onclick = call;
hangupButton.onclick = hangup
