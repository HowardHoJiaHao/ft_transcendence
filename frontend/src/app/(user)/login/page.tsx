'use client';
import React, { useState } from 'react';
import { useAuth } from '@/modules/user/components/AuthContext';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = isRegister ? 'http://localhost:8080/api/v1/auth/register' : 'http://localhost:8080/api/v1/auth/login';
    
    try
	{
      const res = await fetch(endpoint, { //use fetch to get response from fetch sending http request. wait for server reply
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json(); //read and parse the response body. wait for body parsing
      if (res.ok)
	  {
        login(data);
        router.push('/'); //navigate user to route homepage
      } 
	  else
        alert(data.error); //shows a popup error returned by backend
    }
	catch (err)
	{
      console.error(err); //prints error in browser dev console
      alert('Network error'); //shows alert for user
    }
  };

  return (
    <div className={styles.container}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h2>{isRegister ? 'Register' : 'Login'}</h2>
        <input 
          type="text" 
          placeholder="Username" 
          value={username} 
          onChange={(e) => setUsername(e.target.value)} 
          required 
          className={styles.input}
        />
        <input 
          type="password"  //typed chars are masked
          placeholder="Password"  //only "password" text shown when input empty. so that field is known as place to write password
          value={password} //what inputted given to react. controlled inout method
          onChange={(e) => setPassword(e.target.value)} //every time user types save to password state
          required 
          className={styles.input}
        />
        {isRegister && (
            <input 
                type="email" 
                placeholder="Email address" 
                required 
                className={styles.input}
            />
        )}
        <button type="submit" className={styles.button}>
          {isRegister ? 'Sign Up' : 'Sign In'}
        </button>
        <p className={styles.toggle} onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? 'Already have an account? Login' : `Don't have an account? Register`}
        </p>
      </form>
    </div>
  );
}