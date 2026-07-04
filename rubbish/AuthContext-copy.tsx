'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';

type User = {
  id: number;
  username: string;
  email: string;
  avatar?: string; //? means it can be missing
  avatar_url?: string;
  status: string;
};

interface AuthContextType {
  user: User | null; // user can be typeuser or null
  login: (userData: User) => void; //contains a login function that accept user data and void to indicate it returns nothing
  logout: () => void; // a function with no parameter and no return
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = (userData: User) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData)); //persist user in local storage so login survives page refresh
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user'); //removes saved user from local storage
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}> 
      {children}
    </AuthContext.Provider>
  ); //renders context and passes user, login, logout to descendants
} //renders child components inside provider
 

export function useAuth() { //define and export a custom hook to access the auth context
  const context = useContext(AuthContext); //reads current context value from nearest authcontext.provider
  if (context === undefined) //check if hooks used outside provider
  {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
