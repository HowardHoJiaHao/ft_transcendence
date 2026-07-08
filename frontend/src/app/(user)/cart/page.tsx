'use client'

import { useEffect, useState } from 'react'
import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/Toast/ToastContext'
import Header from '@/components/Header/Header'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from './cart.module.css'

interface PurchaseOrder {
	id: number;
	listingId: number;
	quantity: number;
	totalPrice: number;
	status: string;
	paymentMethod: string;
	createdAt: string;
	listingTitle: string;
	listingImage: string;
	sellerName: string;
}

export default function CartPage() {
	const { items, removeFromCart, updateQuantity, clearCart, total } = useCart();
	const { user } = useAuth();
	const { showToast } = useToast();
	const router = useRouter();
	const [activeTab, setActiveTab] = useState<'cart' | 'purchases'>('cart');
	const [isCheckingOut, setIsCheckingOut] = useState(false);
	const [checkoutError, setCheckoutError] = useState('');
	const [orders, setOrders] = useState<PurchaseOrder[]>([]);
	const [ordersLoading, setOrdersLoading] = useState(false);
	const [ordersLoaded, setOrdersLoaded] = useState(false);
	const getImageUrl = (url: string) => {
		if (!url)
			return 'https://via.placeholder.com/100';
		if (url.startsWith('http'))
			return url;
		return `/${url}`;
	};
	const handleCheckout = async () => {
		setCheckoutError('');
		if (!user) {
			showToast('Please login first', 'error');
			router.push('/login');
			return;
		}
		const token = localStorage.getItem('token');
		if (!token) {
			showToast('Please login again', 'error');
			router.push('/login');
			return;
		}
		setIsCheckingOut(true);
		try {
			const res = await fetch('/api/v1/orders', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					items: items.map(item => ({
						listingId: item.id,
						quantity: item.quantity,
					})),
					paymentMethod: 'meetup',
				}),
			});
			const data = await res.json().catch(() => ({})) as { error?: string };
			if (!res.ok) {
				const message = data.error || 'Checkout failed';
				setCheckoutError(message);
				showToast(message, 'error');
				return;
			}
			clearCart();
			showToast('Checkout successful', 'success');
		} catch (err) {
			setCheckoutError('Network error during checkout');
			showToast('Network error during checkout', 'error');
		} finally {
			setIsCheckingOut(false);
		}
	};
	const statusLabel = (status: string) => {
		if (status === 'pending')
			return 'Seller preparing';
		if (status === 'completed')
			return 'Delivered / Completed';
		if (status === 'cancelled')
			return 'Cancelled';
		if (status === 'refunded')
			return 'Refunded';
		return status;
	};
	const formatDate = (value: string) => {
		try {
			return new Date(value).toLocaleDateString('en-MY', {
				day: '2-digit',
				month: 'short',
				year: 'numeric',
			});
		} catch {
			return value;
		}
	};

	useEffect(() => {
		if (activeTab !== 'purchases' || ordersLoaded || !user)
			return;
		const token = localStorage.getItem('token');
		if (!token)
			return;
		setOrdersLoading(true);
		fetch('/api/v1/orders', {
			headers: { Authorization: `Bearer ${token}` },
		})
			.then(async (res) => {
				if (!res.ok) {
					const data = await res.json().catch(() => ({})) as { error?: string };
					throw new Error(data.error || 'Failed to load purchases');
				}
				return res.json();
			})
			.then((data) => {
				setOrders(Array.isArray(data) ? data : []);
				setOrdersLoaded(true);
			})
			.catch((err) => showToast(err instanceof Error ? err.message : 'Failed to load purchases', 'error'))
			.finally(() => setOrdersLoading(false));
	}, [activeTab, ordersLoaded, showToast, user]);

	const renderEmptyCart = () => (
		<div className={styles.empty}>
			<h2>Your cart is empty</h2>
			<Link href="/" className="btn btn-primary">Continue Shopping</Link>
		</div>
	);

	const renderPurchases = () => {
		if (!user) {
			return (
				<div className={styles.empty}>
					<h2>Please login to view purchases</h2>
					<Link href="/login" className="btn btn-primary">Login</Link>
				</div>
			);
		}
		if (ordersLoading)
			return <p className={styles.emptyText}>Loading purchases...</p>;
		if (orders.length === 0) {
			return (
				<div className={styles.empty}>
					<h2>No purchases yet</h2>
					<Link href="/" className="btn btn-primary">Start Shopping</Link>
				</div>
			);
		}
		return (
			<div className={styles.purchaseList}>
				{orders.map(order => (
					<div key={order.id} className={styles.purchaseItem}>
						<img src={getImageUrl(order.listingImage)} alt={order.listingTitle} className={styles.itemImage}/>
						<div className={styles.itemInfo}>
							<h3>{order.listingTitle}</h3>
							<p className={styles.meta}>Seller: {order.sellerName || 'Seller'}</p>
							<p className={styles.meta}>Ordered {formatDate(order.createdAt)} · Qty {order.quantity}</p>
						</div>
						<div className={styles.purchaseSide}>
							<span className={`${styles.statusBadge} ${styles[`status_${order.status}`] || ''}`}>
								{statusLabel(order.status)}
							</span>
							<p className={styles.subtotal}>RM {order.totalPrice.toFixed(2)}</p>
						</div>
					</div>
				))}
			</div>
		);
	};

	return (
		<main>
          <Header />
            <div className={styles.container}>
			  <h1>{activeTab === 'cart' ? `Shopping Cart (${items.length} items)` : 'My Purchases'}</h1>
			  <div className={styles.tabBar}>
				<button className={`${styles.tabBtn} ${activeTab === 'cart' ? styles.tabActive : ''}`} onClick={() => setActiveTab('cart')}>
					Cart
				</button>
				<button className={`${styles.tabBtn} ${activeTab === 'purchases' ? styles.tabActive : ''}`} onClick={() => setActiveTab('purchases')}>
					My Purchases
				</button>
			  </div>

			  {activeTab === 'purchases' ? renderPurchases() : items.length === 0 ? renderEmptyCart() : (
			  <div className={styles.layout}>
			    <div className={styles.items}>
				  {items.map(item => (
					<div key={item.id} className={styles.item}>
					  <img src={getImageUrl(item.image)} alt={item.title} className={styles.itemImage}/>
					  <div className={styles.itemInfo}>
						<h3>{item.title}</h3>
						<p className={styles.price}>RM {item.price.toFixed(2)}</p>
					  </div>
					  <div className="quantitySelector">
						<button className="quantityBtn" onClick={() => updateQuantity(item.id, item.quantity - 1)} disabled={isCheckingOut}>-</button>
						<span className="quantityDisplay"> {item.quantity} </span>
						<button className="quantityBtn "onClick={() => updateQuantity(item.id, item.quantity + 1)} disabled={isCheckingOut}>+</button>
					  </div>
					  <p className={styles.subtotal}>RM {(item.price * item.quantity).toFixed(2)}</p>
					  <button className={styles.removeBtn} onClick={() => removeFromCart(item.id)} disabled={isCheckingOut}>✕</button>
					</div>
				  ))}
				</div>

				<div className={styles.summary}>
				  <h3>Order Summary</h3>
				  <div className={styles.summaryRow}>
				    <span>Subtotal</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  <div className={styles.summaryRow}>
					<span>Shipping</span>
					<span>Free</span>
				  </div>
				  <div className={styles.summaryRow + ' ' + styles.total}>
					<span>Total</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  {checkoutError && <p className={styles.checkoutError}>{checkoutError}</p>}
				  <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }} onClick={handleCheckout} disabled={isCheckingOut}>
					{isCheckingOut ? 'Checking out...' : 'Checkout'}
				  </button>
				  <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px' }} onClick={clearCart} disabled={isCheckingOut}>Clear cart</button>
				</div>
			  </div>
			  )}
			</div>
		</main>
	);
}
