const localVideoElement = document.querySelector('video#localVideo');
const remoteVideoElement = document.querySelector('video#remoteVideo');

const audioCheckBox = document.getElementById('audio');
const videoCheckBox = document.getElementById('video');

const audioSelect = document.querySelector('select#audioSource');
const videoSelect = document.querySelector('select#videoSource');

const createOrJoinButton = document.getElementById("createOrJoinButton");
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const roomNameEle = document.getElementById('roomname');
const userNameEle = document.getElementById('username');

var roomName;
var userName;

import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";
// get a socket connection
const socket = io();

// get mediaStream: https://github.com/webrtc/samples/tree/gh-pages/src/content/devices/input-output
function gotDevices(devices) {
    for (let i = 0; i !== devices.length; ++i) {
        const deviceInfo = devices[i];
        const option = document.createElement('option');
        option.value = deviceInfo.deviceId;
        console.log(option.value)
        if (deviceInfo.kind === 'audioinput') {
            option.text = deviceInfo.label || `microphone ${audioSelect.length + 1}`;
            audioSelect.appendChild(option);
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
    console.log("localVideoStream:", stream);
    localVideoElement.srcObject = stream;
    // TODO: RTCPeerConnection addStream / add stream
    // need to re-negotiate SDPs
    if (peersReady) callButton.disabled = false;
    toggleAudio();
    toggleVideo();
}

function start() {
    const audioSource = audioSelect.value;
    const videoSource = videoSelect.value;
    const constraints = {
        "audio": { deviceId: audioSource ? { exact: audioSource } : undefined },
        "video": { deviceId: videoSource ? { exact: videoSource } : undefined }
    };
    return navigator.mediaDevices.getUserMedia(constraints).then(gotStream, (err) => {
        console.log("failed to get user media, error occurred:", err);
    });
}

// 1. create RTCPeerConnection for each end, add local stream
// 2. get and share with the other your ICE candidates.
// 3. get and share local descriptions (metadata about local media in SDP format)

let servers = {
    iceServers: [
        { url: "stun:stun.xten.com:3478" },
        { url: "stun:stun.stunprotocol.org:3478" }
    ]
}
let pc = null;

function handleConnection(event) {
    // let server relay this candidate info to other peer
    // console.log("candidate event:", event)
    if (event.candidate) {
        console.log(`got my ${event.candidate.protocol} candidate ${event.candidate.address}:${event.candidate.port}`)
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
    console.log("got remote stream:", e)
    if (e.streams && e.streams[0]) {
        remoteVideoElement.srcObject = e.streams[0];
    } else {
        if (!remoteVideoElement.srcObject) {
            remoteVideoElement.srcObject = new MediaStream();
        }
        const oldTrack = remoteVideoElement.srcObject.getTracks().find((track) => {
            return track.kind == e.track.kind;
        });
        if (oldTrack) remoteVideoElement.srcObject.removeTrack(oldTrack);
        remoteVideoElement.srcObject.addTrack(e.track);
    }
    callButton.disabled = true;
    hangupButton.disabled = false;
}

function changeConnectionState(connectionState) {
    let connectionStateElement = document.getElementById('connectionState');
    connectionStateElement.className = `${connectionState}-state`;
    connectionStateElement.innerText = `${connectionState}`;
}

function setLocalAndSendSDP(desc) {
    pc.setLocalDescription(desc).then(
        function() {
            console.log("local description for local set:", desc);
        }
    );
    socket.emit("message", roomName, desc);
}

function negotiate() {
    console.log("inside negotiate()")
    pc.createOffer(
        {
            offerToReceiveAudio: 1,
            offerToReceiveVideo: 1
        }
    ).then(setLocalAndSendSDP);
}

function initPeerConnection() {
    // get iceCandidates from stun/turn servers
    pc = new RTCPeerConnection(servers);
    pc.onconnectionstatechange = () => changeConnectionState(pc.connectionState);
    pc.onicecandidate = handleConnection;
    // remote peer added stream
    pc.ontrack = gotRemoteStream;
    pc.onnegotiationneeded = negotiate;
    // TODO: remote peer removed stream
    // pc.onremovestream
    for (const track of localVideoElement.srcObject.getTracks()) {
        pc.addTrack(track);
    }
}

// create connection and exchange sdp
// use socketio to send (candidates + sdp) to the other peer
function call() {
    callButton.disabled = true;
    hangupButton.disabled = false;

    initPeerConnection();
}


function hangup() {
    if (pc) {
        pc.close();
        pc = null;
    }
    changeConnectionState('disconnected');
    remoteVideoElement.srcObject = null;
    callButton.disabled = false;
    hangupButton.disabled = true;
}

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
        console.log(`adding peer ${candidate.protocol} candidate ${candidate.address}:${candidate.port}`)
        pc.addIceCandidate(candidate);
    } else if (message.type === "offer") {
        if (!pc) {
            initPeerConnection();
        }
        let sessionDescription = new RTCSessionDescription(message)
        console.log("peer offering sdp: ", sessionDescription)
        pc.setRemoteDescription(sessionDescription);
        pc.createAnswer().then(setLocalAndSendSDP);
    } else if (message.type === "answer") {
        let sessionDescription = new RTCSessionDescription(message)
        console.log("peer answering sdp: ", sessionDescription)
        pc.setRemoteDescription(sessionDescription);
    } else if (message.type === "chat") {
        console.log(`[${message.from}]:`, message.data)
    } else {
        console.log("message from server: ", message);
    }
});

// this will be relayed by the socket.io server
function chat(message) {
    socket.emit("message", roomName, {
        type: "chat",
        from: userName,
        data: message
    });
}

function createOrJoinRoom() {
    roomName = roomNameEle.value;
    userName = userNameEle.value;
    socket.emit('create or join', roomName, userName, (success, msg) => {
        if (success) {
            createOrJoinButton.disabled = true;
            roomNameEle.disabled = true;
            userNameEle.disabled = true;
            console.log(`${msg} room ${roomName}.`);
        } else {
            alert(`create or join room ${roomName} failed: ${msg}`);
        }
    });
}

createOrJoinButton.onclick = createOrJoinRoom;

function toggleAudio() {
    const isEnabled = audioCheckBox.checked;
    audioSelect.disabled = !isEnabled;
    if (localVideoElement.srcObject) {
        localVideoElement.srcObject.getAudioTracks().forEach(track => track.enabled = isEnabled);
    }
}

function toggleVideo() {
    const isEnabled = videoCheckBox.checked;
    videoSelect.disabled = !isEnabled;
    if (localVideoElement.srcObject) {
        localVideoElement.srcObject.getVideoTracks().forEach(track => track.enabled = isEnabled);
    }
}

audioCheckBox.onchange = toggleAudio;
videoCheckBox.onchange = toggleVideo;

function replaceTrack(kind) {
    const source = (kind == "audio") ? audioSelect.value : videoSelect.value;
    const constraints = {};
    constraints[kind] = { deviceId: {exact: source }}
    return navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        const newTrack = stream.getTracks()[0];
        const oldTrack = localVideoElement.srcObject.getTracks().find((track) => {
            return track.kind == newTrack.kind;
        });
        localVideoElement.srcObject.addTrack(newTrack);
        if (oldTrack) localVideoElement.srcObject.removeTrack(oldTrack);
        if (pc) {
            const oldTrackSender = pc.getSenders().find((sender) => {
                return sender.track && sender.track.kind == newTrack.kind;
            })
            if (oldTrackSender) oldTrackSender.replaceTrack(newTrack);
        }
    }, (err) => {
        console.log(`failed to get ${kind}, error occurred:`, err);
    });

}

audioSelect.onchange = () => replaceTrack("audio");
videoSelect.onchange = () => replaceTrack("video");

// generate random roomName
roomNameEle.value = btoa(+new Date).slice(-6, -2);
// get local devices
start();
navigator.mediaDevices.enumerateDevices().then(gotDevices);

callButton.onclick = call;
hangupButton.onclick = () => {
    hangup();
    socket.emit("message", roomName, "bye");
}
