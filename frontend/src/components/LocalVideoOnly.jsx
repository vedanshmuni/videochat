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
      console.log('[Socket] Connected to server');
      console.log('[Socket] My socket ID:', socketRef.current.id);
      socketRef.current.emit('join');
    });
    socketRef.current.onAny((event, ...args) => {
      console.log('[Socket Event]', event, args);
    });
    socketRef.current.on('partner-found', ({ partnerId, role }) => {
      setStatus('Partner found! Connecting...');
      setRole(role);
      console.log('[Socket] Partner found:', partnerId, 'Role:', role);
      createPeerConnection(partnerId, role);
    });
    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleIceCandidate);
    socketRef.current.on('partner-left', () => {
      setStatus('Partner left. Refresh to try again.');
      console.log('[Socket] Partner left');
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });
  }

  function createPeerConnection(partnerId, role) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    });
    peerConnectionRef.current = pc;
    console.log('[WebRTC] Created RTCPeerConnection', pc);
    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
        console.log('[WebRTC] Added local track:', track.kind);
      });
    }
    // ICE
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] ICE candidate:', event.candidate);
        socketRef.current.emit('ice-candidate', {
          target: partnerId,
          candidate: event.candidate
        });
      }
    };
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
      setStatus('ICE connection state: ' + pc.iceConnectionState);
    };
    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', pc.connectionState);
      setStatus('Connection state: ' + pc.connectionState);
    };
    // Remote stream
    pc.ontrack = (event) => {
      console.log('[WebRTC] ontrack event:', event.streams);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.play().catch(e => console.log('Remote video play error:', e));
      }
    };
    // Only the offerer creates offer
    if (role === 'offerer') {
      pc.createOffer()
        .then(offer => {
          console.log('[WebRTC] Created offer:', offer);
          return pc.setLocalDescription(offer);
        })
        .then(() => {
          console.log('[WebRTC] Set local description (offer)');
          socketRef.current.emit('offer', {
            target: partnerId,
            sdp: pc.localDescription
          });
        });
    }
  }

  async function handleOffer(data) {
    console.log('[Socket] Received offer event', data);
    if (!peerConnectionRef.current) return;
    if (role !== 'answerer') return; // Only answerer handles offer
    console.log('[WebRTC] Received offer:', data.sdp);
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    console.log('[WebRTC] Set remote description (offer)');
    // Add any queued ICE candidates
    if (pendingCandidatesRef.current.length > 0) {
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
          console.log('[WebRTC] Added queued ICE candidate');
        } catch (e) {
          console.error('Error adding queued ICE candidate', e);
        }
      }
      pendingCandidatesRef.current = [];
    }
    const answer = await peerConnectionRef.current.createAnswer();
    console.log('[WebRTC] Created answer:', answer);
    await peerConnectionRef.current.setLocalDescription(answer);
    console.log('[WebRTC] Set local description (answer)');
    socketRef.current.emit('answer', {
      target: data.target,
      sdp: peerConnectionRef.current.localDescription
    });
  }

  async function handleAnswer(data) {
    if (!peerConnectionRef.current) return;
    if (role !== 'offerer') return; // Only offerer handles answer
    console.log('[WebRTC] Received answer:', data.sdp);
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    console.log('[WebRTC] Set remote description (answer)');
    // Add any queued ICE candidates
    if (pendingCandidatesRef.current.length > 0) {
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
          console.log('[WebRTC] Added queued ICE candidate');
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
      console.log('[WebRTC] Received ICE candidate:', data.candidate);
      const candidate = new RTCIceCandidate(data.candidate);
      if (
        peerConnectionRef.current.remoteDescription &&
        peerConnectionRef.current.remoteDescription.type
      ) {
        await peerConnectionRef.current.addIceCandidate(candidate);
        console.log('[WebRTC] Added ICE candidate');
      } else {
        pendingCandidatesRef.current.push(candidate);
        console.log('[WebRTC] Queued ICE candidate');
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