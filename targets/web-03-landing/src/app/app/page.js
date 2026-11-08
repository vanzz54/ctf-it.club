"use client";

import Image from 'next/image';
import { useState } from 'react';

export default function Home() {
  const [uploadStatus, setUploadStatus] = useState('');

  const handleUpload = (e) => {
    e.preventDefault();
    setUploadStatus('Processing file...');

    // Fake delay for realism
    setTimeout(() => {
      setUploadStatus('Error: File upload temporarily disabled due to WAF security policies.');
    }, 1500);
  };

  return (
    <div style={{
      background: '#0f172a',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      scrollBehavior: 'smooth'
    }}>
      <header style={{
        width: '100%',
        padding: '20px 50px',
        background: '#1e293b',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxSizing: 'border-box',
        borderBottom: '1px solid #334155',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <h1 style={{ margin: 0, color: '#00ffaa', fontSize: '1.5rem', letterSpacing: '2px' }}>CYBERNUSA</h1>
        <nav>
          <a href="#home" style={{ color: '#94a3b8', textDecoration: 'none', marginLeft: '30px', fontWeight: '500' }}>Home</a>
          <a href="#services" style={{ color: '#94a3b8', textDecoration: 'none', marginLeft: '30px', fontWeight: '500' }}>Services</a>
          <a href="#contact" style={{ color: '#94a3b8', textDecoration: 'none', marginLeft: '30px', fontWeight: '500' }}>Contact</a>
        </nav>
      </header>

      <main style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* HERO SECTION */}
        <section id="home" style={{
          width: '100%',
          maxWidth: '1200px',
          padding: '80px 20px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <h2 style={{ fontSize: '3.5rem', marginBottom: '20px', fontWeight: '800', lineHeight: '1.2' }}>
            Securing Your <span style={{ color: '#00ffaa' }}>Digital</span> Future.
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: '1.2rem', maxWidth: '600px', marginBottom: '60px', lineHeight: '1.6' }}>
            Welcome to the official portal of CyberNusa. We provide cutting-edge cybersecurity solutions
            for modern enterprises.
          </p>

          <div style={{
            width: '100%',
            maxWidth: '900px',
            height: '450px',
            position: 'relative',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 255, 170, 0.15)',
            border: '1px solid #334155'
          }}>
            <Image
              src="/hero.jpg"
              alt="CyberNusa Hero"
              fill
              style={{ objectFit: 'cover' }}
              priority
            />
          </div>
        </section>

        {/* SERVICES SECTION */}
        <section id="services" style={{
          width: '100%',
          background: '#1e293b',
          padding: '80px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '40px', color: '#00ffaa' }}>Our Services</h2>
          <div style={{
            display: 'flex',
            gap: '30px',
            maxWidth: '1200px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            <div style={{ background: '#0f172a', padding: '30px', borderRadius: '12px', width: '300px', border: '1px solid #334155' }}>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '15px' }}>Penetration Testing</h3>
              <p style={{ color: '#94a3b8' }}>Comprehensive security assessment of your web applications, networks, and cloud infrastructure.</p>
            </div>
            <div style={{ background: '#0f172a', padding: '30px', borderRadius: '12px', width: '300px', border: '1px solid #334155' }}>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '15px' }}>Incident Response</h3>
              <p style={{ color: '#94a3b8' }}>24/7 rapid response team ready to contain and eradicate threats in your environment.</p>
            </div>
            <div style={{ background: '#0f172a', padding: '30px', borderRadius: '12px', width: '300px', border: '1px solid #334155' }}>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '15px' }}>Security Audit</h3>
              <p style={{ color: '#94a3b8' }}>In-depth review of your security architecture, policies, and compliance readiness.</p>
            </div>
          </div>
        </section>

        {/* CONTACT SECTION WITH FAKE UPLOAD */}
        <section id="contact" style={{
          width: '100%',
          maxWidth: '800px',
          padding: '80px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '20px', color: '#00ffaa' }}>Contact Us</h2>
          <p style={{ color: '#cbd5e1', marginBottom: '40px', textAlign: 'center' }}>
            Have a project in mind or need to report a vulnerability?
            Please upload your documentation below.
          </p>

          <form onSubmit={handleUpload} style={{
            background: '#1e293b',
            padding: '40px',
            borderRadius: '16px',
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid #334155',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Name</label>
              <input type="text" required style={{
                width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #334155',
                background: '#0f172a', color: '#fff', boxSizing: 'border-box'
              }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Message / Report Details</label>
              <textarea rows="4" required style={{
                width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #334155',
                background: '#0f172a', color: '#fff', boxSizing: 'border-box'
              }}></textarea>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Upload Supporting Document (.pdf, .png)</label>
              <input type="file" required style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px dashed #00ffaa',
                background: '#0f172a', color: '#94a3b8', boxSizing: 'border-box', cursor: 'pointer'
              }} />
              <small style={{ color: '#64748b', display: 'block', marginTop: '8px' }}>Max file size: 5MB. All uploads are scanned.</small>
            </div>

            <button type="submit" style={{
              background: '#00ffaa',
              color: '#0f172a',
              padding: '14px',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginTop: '10px'
            }}>
              Submit Report
            </button>

            {uploadStatus && (
              <div style={{
                marginTop: '15px',
                padding: '15px',
                borderRadius: '8px',
                background: uploadStatus.includes('Error') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 255, 170, 0.1)',
                color: uploadStatus.includes('Error') ? '#ef4444' : '#00ffaa',
                border: uploadStatus.includes('Error') ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(0, 255, 170, 0.3)',
                textAlign: 'center'
              }}>
                {uploadStatus}
              </div>
            )}
          </form>
        </section>
      </main>

      <footer style={{
        width: '100%',
        padding: '30px',
        background: '#1e293b',
        textAlign: 'center',
        color: '#64748b',
        borderTop: '1px solid #334155',
        marginTop: 'auto'
      }}>
        <p>&copy; 2026 CyberNusa Official. All rights reserved.</p>
      </footer>
    </div>
  );
}
