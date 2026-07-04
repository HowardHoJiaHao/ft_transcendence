'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface CartItem {
	id: number;
	title: string;
	price: number;
	image: string;
	quantity: number;
}

interface CartContextType {
	items: CartItem[];
	addToCart: (product: Omit<CartItem, 'quantity'>, quantity?: number) => void;
	removeFromCart: (id: number) => void;
	updateQuantity: (id: number, quantity: number) => void;
	clearCart: () => void;
	total: number;
	itemCount: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
	const [items, setItems] = useState<CartItem[]>([]);

	//load from localstorage
	useEffect(() => {
		const saved = localStorage.getItem('cart');
		if (saved)
			setItems(JSON.parse(saved));
	}, []);

	//save to localstorage
	useEffect(() => {
		localStorage.setItem('cart', JSON.stringify(items));
	}, [items]);

	//addtocart
	const addToCart = (product: Omit<CartItem, 'quantity'>, quantity: number = 1) => {
		setItems(prev => {
			const existing = prev.find(i => i.id === product.id);
			if (existing)
				return prev.map(i => i.id === product.id ? {...i, quantity: i.quantity + quantity } : i);
			return [...prev, { ...product, quantity}]
		})
	}

	const removeFromCart = (id: number) => {
		setItems(prev => prev.filter(i => i.id !== id));
	};

	const updateQuantity = (id: number, quantity: number) => {
		if (quantity <= 0)
		{
			removeFromCart(id);
			return ;
		}
		setItems(prev =>
			prev.map(i => i.id === id ? {...i, quantity } : i)
		);
	};

	const clearCart = () => setItems([]);

	const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
	const itemCount = items.reduce((sum, i) => sum + i.quantity, 0 );

	return (
		<CartContext.Provider value={{
			items, addToCart, removeFromCart, updateQuantity,
			clearCart, total, itemCount
		}}>
			{children}
		</CartContext.Provider>
	);
}

export const useCart = () => {
	const ctx = useContext(CartContext);
	if (!ctx)
		throw new Error('useCart must be used within CartProvider');
	return ctx;
}