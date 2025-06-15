import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const LocalVideoOnly = () => {
  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Waiting for camera...');
  const [role, setRole] = useState(null); // 'offerer' or 'answerer'
  const pendingCandidatesRef = useRef([]);

  useEffect(() => {
    // Get local media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.log('Video play error:', e));
        }
        localStreamRef.current = stream;
        setStatus('Connecting to server...');
        startSignaling();
      })
      .catch((err) => {
        setError('Error accessing camera and microphone: ' + err.message);
      });
    // Cleanup
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    // eslint-disable-next-line
  }, []);

  function startSignaling() {
    socketRef.current = io(BACKEND_URL);
    socketRef.current.on('connect', () => {
      setStatus('Connected to server, waiting for partner...');
      socketRef.current.emit('join');
    });
    socketRef.current.on('partner-found', ({ partnerId, role }) => {
      setStatus('Partner found! Connecting...');
      setRole(role);
      createPeerConnection(partnerId, role);
    });
    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleIceCandidate);
    socketRef.current.on('partner-left', () => {
      setStatus('Partner left. Refresh to try again.');
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });
  }

  function createPeerConnection(partnerId, role) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
    peerConnectionRef.current = pc;
    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    // ICE
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          target: partnerId,
          candidate: event.candidate
        });
      }
    };
    // Remote stream
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    // Only offerer creates offer
    if (role === 'offerer') {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socketRef.current.emit('offer', {
            target: partnerId,
            sdp: pc.localDescription
          });
        });
    }
  }

  async function handleOffer(data) {
    if (!peerConnectionRef.current) return;
    if (role !== 'answerer') return;
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    // Add any queued ICE candidates
    if (pendingCandidatesRef.current.length > 0) {
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding queued ICE candidate', e);
        }
      }
      pendingCandidatesRef.current = [];
    }
    const answer = await peerConnectionRef.current.createAnswer();
    await peerConnectionRef.current.setLocalDescription(answer);
    socketRef.current.emit('answer', {
      target: data.target,
      sdp: peerConnectionRef.current.localDescription
    });
  }

  async function handleAnswer(data) {
    if (!peerConnectionRef.current) return;
    if (role !== 'offerer') return;
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    // Add any queued ICE candidates
    if (pendingCandidatesRef.current.length > 0) {
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding queued ICE candidate', e);
        }
      }
      pendingCandidatesRef.current = [];
    }
  }

  async function handleIceCandidate(data) {
    try {
      if (!peerConnectionRef.current) return;
      const candidate = new RTCIceCandidate(data.candidate);
      if (
        peerConnectionRef.current.remoteDescription &&
        peerConnectionRef.current.remoteDescription.type
      ) {
        await peerConnectionRef.current.addIceCandidate(candidate);
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    } catch (e) {
      console.error('Error adding received ice candidate', e);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center', background: '#222' }}>
      <h2 style={{ color: 'white' }}>Local & Remote Video (WebRTC Test)</h2>
      <div style={{ color: 'white', marginBottom: 8 }}>{status}</div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 32 }}>
        <div>
          <div style={{ color: 'white', marginBottom: 4 }}>You</div>
          <video ref={videoRef} autoPlay playsInline muted width={400} height={300} style={{ background: '#000' }} />
        </div>
        <div>
          <div style={{ color: 'white', marginBottom: 4 }}>Partner</div>
          <video ref={remoteVideoRef} autoPlay playsInline width={400} height={300} style={{ background: '#000' }} />
        </div>
      </div>
    </div>
  );
};

export default LocalVideoOnly; 