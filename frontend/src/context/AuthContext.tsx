'use client'; //means that it is for browser. it must be interactive
import React, { createContext, useContext, useState, useEffect } from 'react';

//createContext. create an antenna that can allow component connected to it using anything inside it w/o having to pass through parent and child
//useContext. allow component to join the antenna
//useState. how a react component remembers things. it stores two things a variable and a setter and set 1 thing. [variable, setter] = useState('intialvalueofvariable')
//useEffect. is a component autopilot. fetching data (when page load automatically take user list), subscriptions (listen whenever user click outside menu), synchronization (whenever variables change, store it)

type User = {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNo?: string;
  gender?: string;
  dateOfBirth?: string;
  avatarUrl?: string;
  status: string;	
};

interface AuthContextType {
	user: User | null;
	login: (userData: User) => void;
	logout: () => void;
	updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined); //<> what can live inside context. the initialization of values

//in javascript every function is private to a file. by declaring export it can be accessed by other files too
export function AuthProvider({ children }: { children: React.ReactNode }) //by putting  { children } it defines whatever i put inside the <AuthProvider>  .... <AuthProvider> is a child. { children: React} the child be can be any react component
{
	const [user, setUser] = useState<User | null>(null); //typescript version <User | null> means can only hold these two types. null is the initial value

	//			RUN WHEN IT LOADS
	useEffect(() =>
	{
		const storedUser = localStorage.getItem('user') //goes to browser storage and see is there a string labeled user
		if (storedUser)
			setUser(JSON.parse(storedUser)); //translate string into live javascript object
	}, []); //run the code exactly

	const login = (userData: User) =>
	{
		setUser(userData); //put user data in state variable
		localStorage.setItem('user', JSON.stringify(userData)); //store in local storage. label user and text in json format instead of typescript object
	};

	const logout = () => 
	{
		setUser(null);
		localStorage.removeItem('user'); //removes saved user from website storage
	};

	const updateUser = (updates: Partial<User>) => {
		setUser(prev => {
			if (!prev) return prev;
			const updated = { ...prev, ...updates };
			localStorage.setItem('user', JSON.stringify(updated));
			return updated;
		});
	};

	return (
		<AuthContext.Provider value={{ user, login, logout, updateUser}}>
			{children}
		</AuthContext.Provider>
	) //renders context and passes user, login, logout to descendants
} //renders child components inside provider

//define and export a custom hook to access the auth context
export function useAuth()
{
	const context = useContext(AuthContext); //red current context value from authContext.Provider
	if (context === undefined)
		throw new Error('useAuth must be used within an AuthProvider')
	return context;
}
