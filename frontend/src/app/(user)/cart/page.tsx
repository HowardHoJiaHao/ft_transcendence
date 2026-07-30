'use client'

import { useEffect, useState } from 'react'
import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/Toast/ToastContext'
import { useI18n } from '@/context/LanguageContext'
import Header from '@/components/Header/Header'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { assignCheckoutLocation, createCheckoutRequestId } from '@/lib/browserNavigation'

// Tailwind classes per order status, replacing the old .status_* CSS module rules.
const STATUS_BADGE_STYLES: Record<string, string> = {
	pending: 'bg-[#fff8e1] text-[#8d6e00]',
	completed: 'bg-[#e6f4ea] text-[#1a7f37]',
	cancelled: 'bg-[#fef2f2] text-[#b91c1c]',
	refunded: 'bg-[#fef2f2] text-[#b91c1c]',
};

interface PurchaseOrder {
	id: number;
	listingId: number;
	quantity: number;
	totalPrice: number;
	status: string;
	paymentMethod: string;
	paymentStatus?: string;
	createdAt: string;
	listingTitle: string;
	listingImage: string;
	sellerName: string;
}

export default function CartPage() {
	const { items, removeFromCart, updateQuantity, clearCart, total } = useCart();
	const { user } = useAuth();
	const { showToast } = useToast();
	const { t } = useI18n();
	const router = useRouter();
	const [activeTab, setActiveTab] = useState<'cart' | 'purchases'>('cart');
	const [isCheckingOut, setIsCheckingOut] = useState(false);
	const [checkoutError, setCheckoutError] = useState('');
	const [orders, setOrders] = useState<PurchaseOrder[]>([]);
	const [ordersLoading, setOrdersLoading] = useState(false);
	const [ordersLoaded, setOrdersLoaded] = useState(false);
	const [paymentMethod, setPaymentMethod] = useState<'meetup' | 'stripe'>('meetup');
	const [stripeCheckoutRequestId, setStripeCheckoutRequestId] = useState('');
	const [stripeReturnState, setStripeReturnState] = useState<'return' | 'cancelled' | null>(null);
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
			let checkoutRequestId = stripeCheckoutRequestId;
			if (paymentMethod === 'stripe' && !checkoutRequestId) {
				checkoutRequestId = createCheckoutRequestId();
				setStripeCheckoutRequestId(checkoutRequestId);
			}
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
					paymentMethod,
					...(paymentMethod === 'stripe' ? { checkoutRequestId } : {}),
				}),
			});
			const data = await res.json().catch(() => ({})) as {
				error?: string;
				checkoutUrl?: string;
			};
			if (!res.ok) {
				const message = data.error || 'Checkout failed';
				setCheckoutError(message);
				showToast(message, 'error');
				if (paymentMethod === 'stripe' && res.status !== 503)
					setStripeCheckoutRequestId('');
				return;
			}
			if (paymentMethod === 'stripe') {
				if (!data.checkoutUrl) {
					const message = t('cart.stripeMissingUrl');
					setCheckoutError(message);
					showToast(message, 'error');
					return;
				}
				clearCart();
				setStripeCheckoutRequestId('');
				assignCheckoutLocation(data.checkoutUrl);
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
	const paymentStatusLabel = (status?: string) => {
		if (!status)
			return '';
		if (status === 'awaiting_payment')
			return t('cart.paymentAwaiting');
		if (status === 'paid')
			return t('cart.paymentPaid');
		if (status === 'failed')
			return t('cart.paymentFailed');
		if (status === 'expired')
			return t('cart.paymentExpired');
		if (status === 'refunded')
			return t('cart.paymentRefunded');
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
		const checkout = new URLSearchParams(window.location.search).get('checkout');
		if (checkout === 'stripe-return') {
			setStripeReturnState('return');
			setActiveTab('purchases');
			setOrdersLoaded(false);
		} else if (checkout === 'stripe-cancelled') {
			setStripeReturnState('cancelled');
		}
	}, []);

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

	const stripeReturnMessage = () => {
		if (stripeReturnState === 'cancelled')
			return t('cart.stripeCancelled');
		if (stripeReturnState === 'return') {
			const paid = orders.some(order =>
				order.paymentMethod === 'stripe' && order.paymentStatus === 'paid',
			);
			return paid ? t('cart.stripeReceived') : t('cart.stripeConfirming');
		}
		return '';
	};

	const renderEmptyCart = () => (
		<div className="text-center px-5 py-[100px]">
			<h2 className="mb-5 text-[#666]">Your cart is empty</h2>
			<Link href="/" className="btn btn-primary">Continue Shopping</Link>
		</div>
	);

	const renderPurchases = () => {
		if (!user) {
			return (
				<div className="text-center px-5 py-[100px]">
					<h2 className="mb-5 text-[#666]">Please login to view purchases</h2>
					<Link href="/login" className="btn btn-primary">Login</Link>
				</div>
			);
		}
		if (ordersLoading)
			return <p className="text-[#666] py-8">Loading purchases...</p>;
		if (orders.length === 0) {
			return (
				<div className="text-center px-5 py-[100px]">
					<h2 className="mb-5 text-[#666]">No purchases yet</h2>
					<Link href="/" className="btn btn-primary">Start Shopping</Link>
				</div>
			);
		}
		return (
			<div className="flex flex-col gap-4">
				{orders.map(order => (
					<div key={order.id} className="flex items-center gap-4 p-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] max-[768px]:flex-wrap">
						<img src={getImageUrl(order.listingImage)} alt={order.listingTitle} className="w-20 h-20 object-cover rounded-lg"/>
						<div className="flex-1">
							<h3 className="text-base mb-1">{order.listingTitle}</h3>
							<p className="text-[#666] text-[13px] mt-1 mb-0">Seller: {order.sellerName || 'Seller'}</p>
							<p className="text-[#666] text-[13px] mt-1 mb-0">Ordered {formatDate(order.createdAt)} · Qty {order.quantity}</p>
						</div>
						<div className="flex flex-col items-end gap-2 ml-auto min-w-[160px] max-[768px]:items-start max-[768px]:ml-0 max-[768px]:w-full">
								<span className={`rounded-full inline-block text-xs font-bold px-3 py-[5px] ${STATUS_BADGE_STYLES[order.status] || ''}`}>
									{statusLabel(order.status)}
								</span>
								{order.paymentMethod === 'stripe' && order.paymentStatus && (
									<span className="text-xs font-semibold text-[#475569]">
										{t('cart.paymentLabel')}: {paymentStatusLabel(order.paymentStatus)}
									</span>
								)}
								<p className="font-bold min-w-20 text-right">RM {order.totalPrice.toFixed(2)}</p>
						</div>
					</div>
				))}
			</div>
		);
	};

	return (
		<main>
	          <Header />
	            <div className="max-w-[1000px] mx-auto p-6">
				  <h1 className="mb-6 text-[#333]">{activeTab === 'cart' ? `Shopping Cart (${items.length} items)` : 'My Purchases'}</h1>
				  {stripeReturnState && (
					<div role="status" className="mb-5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4 text-[#1e3a8a]">
						{stripeReturnMessage()}
					</div>
				  )}
				  <div className="flex gap-2 mb-6 border-b border-[#e5e5e5]">
				<button className={`bg-transparent cursor-pointer text-[15px] font-semibold px-4 py-3 border-0 border-solid border-b-[3px] ${activeTab === 'cart' ? 'text-[#111] border-b-[#111]' : 'text-[#666] border-b-transparent hover:text-[#111]'}`} onClick={() => setActiveTab('cart')}>
					Cart
				</button>
				<button className={`bg-transparent cursor-pointer text-[15px] font-semibold px-4 py-3 border-0 border-solid border-b-[3px] ${activeTab === 'purchases' ? 'text-[#111] border-b-[#111]' : 'text-[#666] border-b-transparent hover:text-[#111]'}`} onClick={() => setActiveTab('purchases')}>
					My Purchases
				</button>
			  </div>

			  {activeTab === 'purchases' ? renderPurchases() : items.length === 0 ? renderEmptyCart() : (
			  <div className="grid grid-cols-[1fr_300px] gap-6 max-[768px]:grid-cols-1">
			    <div className="flex flex-col gap-4">
				  {items.map(item => (
					<div key={item.id} className="flex items-center gap-4 p-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] max-[768px]:flex-wrap">
					  <img src={getImageUrl(item.image)} alt={item.title} className="w-20 h-20 object-cover rounded-lg"/>
					  <div className="flex-1">
						<h3 className="text-base mb-1">{item.title}</h3>
						<p className="text-[#059669] font-bold">RM {item.price.toFixed(2)}</p>
					  </div>
					  <div className="quantitySelector">
						<button className="quantityBtn" onClick={() => updateQuantity(item.id, item.quantity - 1)} disabled={isCheckingOut}>-</button>
						<span className="quantityDisplay"> {item.quantity} </span>
						<button className="quantityBtn "onClick={() => updateQuantity(item.id, item.quantity + 1)} disabled={isCheckingOut}>+</button>
					  </div>
					  <p className="font-bold min-w-20 text-right">RM {(item.price * item.quantity).toFixed(2)}</p>
					  <button className="bg-none border-none text-[#ef4444] cursor-pointer text-lg px-2 py-1 hover:bg-[#fef2f2] hover:rounded disabled:cursor-not-allowed disabled:opacity-50" onClick={() => removeFromCart(item.id)} disabled={isCheckingOut}>✕</button>
					</div>
				  ))}
				</div>

				<div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] h-fit sticky top-6">
				  <h3 className="mb-4 pb-3 border-b border-[#eee]">Order Summary</h3>
				  <div className="flex justify-between mb-3 text-[#666]">
				    <span>Subtotal</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  <div className="flex justify-between mb-3 text-[#666]">
					<span>Shipping</span>
					<span>Free</span>
				  </div>
					  <div className="flex justify-between mb-3 text-lg font-bold text-[#333] pt-3 border-t border-[#eee]">
						<span>Total</span>
						<span>RM {total.toFixed(2)}</span>
					  </div>
					  <fieldset className="mt-4 border-0 p-0">
						<legend className="mb-2 text-sm font-semibold text-[#333]">{t('cart.paymentMethod')}</legend>
						<label className="mb-2 flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="radio"
								name="paymentMethod"
								value="meetup"
								checked={paymentMethod === 'meetup'}
								onChange={() => {
									setPaymentMethod('meetup');
									setStripeCheckoutRequestId('');
								}}
								disabled={isCheckingOut}
							/>
							{t('cart.meetupPayment')}
						</label>
						<label className="flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="radio"
								name="paymentMethod"
								value="stripe"
								checked={paymentMethod === 'stripe'}
								onChange={() => {
									setPaymentMethod('stripe');
									setStripeCheckoutRequestId('');
								}}
								disabled={isCheckingOut}
							/>
							{t('cart.stripePayment')}
						</label>
					  </fieldset>
					  {paymentMethod === 'stripe' && (
						<p className="mt-3 rounded bg-[#f8fafc] p-3 text-xs leading-5 text-[#475569]">
							{t('cart.stripeSandboxNotice')}
						</p>
					  )}
					  {checkoutError && <p className="text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded p-2.5 mt-3 mb-0 text-sm">{checkoutError}</p>}
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
