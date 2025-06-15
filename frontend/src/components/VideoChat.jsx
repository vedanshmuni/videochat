import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './VideoChat.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const VideoChat = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [error, setError] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [interests, setInterests] = useState([]);
    const [showInterests, setShowInterests] = useState(true);
    const [role, setRole] = useState(null); // 'offerer' or 'answerer'
    
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const peerConnectionRef = useRef(null);
    const socketRef = useRef(null);
    const messagesEndRef = useRef(null);
    const localStreamRef = useRef(null); // Store the local stream
    const pendingCandidatesRef = useRef([]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        // Initialize socket connection
        socketRef.current = io(BACKEND_URL);

        // Request camera and microphone permissions
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then((stream) => {
                localStreamRef.current = stream;
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            })
            .catch((err) => {
                setError('Error accessing camera and microphone: ' + err.message + '. Please allow permissions and reload the page.');
            });

        // Socket event handlers
        socketRef.current.on('connect', () => {
            setIsConnected(true);
            setIsWaiting(true);
        });

        socketRef.current.on('partner-found', ({ partnerId, role }) => {
            setIsWaiting(false);
            setShowInterests(false);
            setRole(role);
            createPeerConnection(partnerId, role);
        });

        socketRef.current.on('partner-left', () => {
            setIsWaiting(true);
            setMessages([]);
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
                peerConnectionRef.current = null;
            }
        });

        socketRef.current.on('text-message', (data) => {
            setMessages(prev => [...prev, {
                text: data.message,
                sender: data.sender === socketRef.current.id ? 'me' : 'partner'
            }]);
        });

        socketRef.current.on('offer', handleOffer);
        socketRef.current.on('answer', handleAnswer);
        socketRef.current.on('ice-candidate', handleIceCandidate);

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleStartChat = () => {
        socketRef.current.emit('join', interests);
    };

    const handleNext = () => {
        socketRef.current.emit('next');
        setMessages([]);
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        const rooms = Array.from(socketRef.current.rooms);
        const partner = rooms.find(room => room !== socketRef.current.id);
        
        if (partner) {
            socketRef.current.emit('text-message', {
                target: partner,
                message: newMessage
            });
            setMessages(prev => [...prev, {
                text: newMessage,
                sender: 'me'
            }]);
            setNewMessage('');
        }
    };

    const createPeerConnection = (partnerId, role) => {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };

        const peerConnection = new RTCPeerConnection(configuration);
        peerConnectionRef.current = peerConnection;

        // Add local stream to peer connection
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStreamRef.current);
            });
        }

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current.emit('ice-candidate', {
                    target: partnerId,
                    candidate: event.candidate
                });
            }
        };

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
            }
        };

        // Only the offerer creates and sends the offer
        if (role === 'offerer') {
            peerConnection.createOffer()
                .then(offer => peerConnection.setLocalDescription(offer))
                .then(() => {
                    socketRef.current.emit('offer', {
                        target: partnerId,
                        sdp: peerConnection.localDescription
                    });
                });
        }
    };

    const handleIceCandidate = async (data) => {
        try {
            if (!peerConnectionRef.current) return;
            const candidate = new window.RTCIceCandidate(data.candidate);
            if (
                peerConnectionRef.current.remoteDescription &&
                peerConnectionRef.current.remoteDescription.type
            ) {
                await peerConnectionRef.current.addIceCandidate(candidate);
            } else {
                // Queue the candidate for later
                pendingCandidatesRef.current.push(candidate);
                console.log('Queued ICE candidate');
            }
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    };

    const handleOffer = async (data) => {
        if (role !== 'answerer') return;
        if (!peerConnectionRef.current) return;
        console.log('handleOffer:', peerConnectionRef.current.signalingState, data.sdp.type, role);
        if (peerConnectionRef.current.signalingState !== 'stable') {
            console.warn('Not in stable state, skipping setRemoteDescription for offer');
            return;
        }
        await peerConnectionRef.current.setRemoteDescription(
            new window.RTCSessionDescription(data.sdp)
        );
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
    };

    const handleAnswer = async (data) => {
        if (role !== 'offerer') return;
        if (!peerConnectionRef.current) return;
        console.log('handleAnswer:', peerConnectionRef.current.signalingState, data.sdp.type, role);
        if (peerConnectionRef.current.signalingState !== 'have-local-offer') {
            console.warn('Not in have-local-offer state, skipping setRemoteDescription for answer');
            return;
        }
        await peerConnectionRef.current.setRemoteDescription(
            new window.RTCSessionDescription(data.sdp)
        );
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
    };

    if (showInterests) {
        return (
            <div className="interests-container">
                <h2>Select Your Interests</h2>
                <div className="interests-grid">
                    {['Gaming', 'Music', 'Movies', 'Sports', 'Technology', 'Art', 'Travel', 'Food'].map(interest => (
                        <button
                            key={interest}
                            className={`interest-button ${interests.includes(interest) ? 'selected' : ''}`}
                            onClick={() => {
                                setInterests(prev =>
                                    prev.includes(interest)
                                        ? prev.filter(i => i !== interest)
                                        : [...prev, interest]
                                );
                            }}
                        >
                            {interest}
                        </button>
                    ))}
                </div>
                <button
                    className="start-chat-button"
                    onClick={handleStartChat}
                    disabled={!isConnected}
                >
                    Start Chatting
                </button>
            </div>
        );
    }

    return (
        <div className="video-chat-container">
            {error && <div className="error-message">{error}</div>}
            <div className="chat-grid">
                <div className="video-section">
                    <div className="video-grid">
                        <div className="video-wrapper">
                            <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className="local-video"
                            />
                            <div className="video-label">You</div>
                        </div>
                        <div className="video-wrapper">
                            <video
                                ref={remoteVideoRef}
                                autoPlay
                                playsInline
                                className="remote-video"
                            />
                            <div className="video-label">Partner</div>
                        </div>
                    </div>
                    <button className="next-button" onClick={handleNext}>
                        Next
                    </button>
                </div>
                <div className="chat-section">
                    <div className="messages-container">
                        {messages.map((msg, index) => (
                            <div
                                key={index}
                                className={`message ${msg.sender === 'me' ? 'sent' : 'received'}`}
                            >
                                {msg.text}
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                    <form onSubmit={handleSendMessage} className="message-form">
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                            className="message-input"
                        />
                        <button type="submit" className="send-button">
                            Send
                        </button>
                    </form>
                </div>
            </div>
            {isWaiting && (
                <div className="waiting-message">
                    Waiting for a partner to join...
                </div>
            )}
        </div>
    );
};

export default VideoChat; 