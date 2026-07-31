'use client'

import { useEffect, useState } from 'react'
import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/Toast/ToastContext'
import { useI18n } from '@/context/LanguageContext'
import Header from '@/components/Header/Header'
import ListingImage from '@/components/ListingImage/ListingImage'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
	const handleCheckout = async () => {
		setCheckoutError('');
		if (!user) {
			showToast(t('cart.loginFirst'), 'error');
			router.push('/login');
			return;
		}
		const token = localStorage.getItem('token');
		if (!token) {
			showToast(t('cart.loginAgain'), 'error');
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
				const message = data.error || t('cart.checkoutFailed');
				setCheckoutError(message);
				showToast(message, 'error');
				return;
			}
			clearCart();
			showToast(t('cart.checkoutSuccess'), 'success');
		} catch (err) {
			setCheckoutError(t('cart.checkoutNetworkError'));
			showToast(t('cart.checkoutNetworkError'), 'error');
		} finally {
			setIsCheckingOut(false);
		}
	};
	const statusLabel = (status: string) => {
		// Mirrors the seller's "Pending Delivery" tab, so both sides of a sale
		// name the same waiting state identically.
		if (status === 'pending')
			return t('cart.statusPending');
		if (status === 'completed')
			return t('cart.statusCompleted');
		if (status === 'cancelled')
			return t('cart.statusCancelled');
		if (status === 'refunded')
			return t('cart.statusRefunded');
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
					throw new Error(data.error || t('cart.loadPurchasesFailed'));
				}
				return res.json();
			})
			.then((data) => {
				setOrders(Array.isArray(data) ? data : []);
				setOrdersLoaded(true);
			})
			.catch((err) => showToast(err instanceof Error ? err.message : t('cart.loadPurchasesFailed'), 'error'))
			.finally(() => setOrdersLoading(false));
	}, [activeTab, ordersLoaded, showToast, t, user]);

	const renderEmptyCart = () => (
		<div className="text-center px-5 py-[100px]">
			<h2 className="mb-5 text-[#666]">{t('cart.empty')}</h2>
			<Link href="/" className="btn btn-primary">{t('cart.continueShopping')}</Link>
		</div>
	);

	const renderPurchases = () => {
		if (!user) {
			return (
				<div className="text-center px-5 py-[100px]">
					<h2 className="mb-5 text-[#666]">{t('cart.loginToView')}</h2>
					<Link href="/login" className="btn btn-primary">{t('cart.login')}</Link>
				</div>
			);
		}
		if (ordersLoading)
			return <p className="text-[#666] py-8">{t('cart.loadingPurchases')}</p>;
		if (orders.length === 0) {
			return (
				<div className="text-center px-5 py-[100px]">
					<h2 className="mb-5 text-[#666]">{t('cart.noPurchases')}</h2>
					<Link href="/" className="btn btn-primary">{t('cart.startShopping')}</Link>
				</div>
			);
		}
		return (
			<div className="flex flex-col gap-4">
				{orders.map(order => (
					<div key={order.id} className="flex items-center gap-4 p-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] max-[768px]:flex-wrap">
						<ListingImage src={order.listingImage} alt={order.listingTitle} className="w-20 h-20 object-cover rounded-lg"/>
						<div className="flex-1">
							<h3 className="text-base mb-1">{order.listingTitle}</h3>
							<p className="text-[#666] text-[13px] mt-1 mb-0">{t('cart.seller', { name: order.sellerName || t('cart.sellerFallback') })}</p>
							<p className="text-[#666] text-[13px] mt-1 mb-0">{t('cart.orderedOn', { date: formatDate(order.createdAt), quantity: order.quantity })}</p>
						</div>
						<div className="flex flex-col items-end gap-2 ml-auto min-w-[160px] max-[768px]:items-start max-[768px]:ml-0 max-[768px]:w-full">
							<span className={`rounded-full inline-block text-xs font-bold px-3 py-[5px] ${STATUS_BADGE_STYLES[order.status] || ''}`}>
								{statusLabel(order.status)}
							</span>
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
			  <h1 className="mb-6 text-[#333]">{activeTab === 'cart' ? t('cart.title', { count: items.length }) : t('cart.purchasesTitle')}</h1>
			  <div className="flex gap-2 mb-6 border-b border-[#e5e5e5]">
				<button className={`bg-transparent cursor-pointer text-[15px] font-semibold px-4 py-3 border-0 border-solid border-b-[3px] ${activeTab === 'cart' ? 'text-[#111] border-b-[#111]' : 'text-[#666] border-b-transparent hover:text-[#111]'}`} onClick={() => setActiveTab('cart')}>
					{t('cart.tabCart')}
				</button>
				<button className={`bg-transparent cursor-pointer text-[15px] font-semibold px-4 py-3 border-0 border-solid border-b-[3px] ${activeTab === 'purchases' ? 'text-[#111] border-b-[#111]' : 'text-[#666] border-b-transparent hover:text-[#111]'}`} onClick={() => setActiveTab('purchases')}>
					{t('cart.tabPurchases')}
				</button>
			  </div>

			  {activeTab === 'purchases' ? renderPurchases() : items.length === 0 ? renderEmptyCart() : (
			  <div className="grid grid-cols-[1fr_300px] gap-6 max-[768px]:grid-cols-1">
			    <div className="flex flex-col gap-4">
				  {items.map(item => (
					<div key={item.id} className="flex items-center gap-4 p-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] max-[768px]:flex-wrap">
					  <ListingImage src={item.image} alt={item.title} className="w-20 h-20 object-cover rounded-lg"/>
					  <div className="flex-1">
						<h3 className="text-base mb-1">{item.title}</h3>
						<p className="text-[#059669] font-bold">RM {item.price.toFixed(2)}</p>
					  </div>
					  {/* Listings sell as a whole lot, so the quantity is the
					      listing's own and cannot be adjusted here. */}
					  <span className="text-[#666] text-sm min-w-20 text-center">
						{item.quantity > 1 ? t('cart.lotOf', { count: item.quantity }) : t('cart.qtyOne')}
					  </span>
					  <p className="font-bold min-w-20 text-right">RM {(item.price * item.quantity).toFixed(2)}</p>
					  <button className="bg-none border-none text-[#ef4444] cursor-pointer text-lg px-2 py-1 hover:bg-[#fef2f2] hover:rounded disabled:cursor-not-allowed disabled:opacity-50" aria-label={t('cart.remove', { title: item.title })} onClick={() => removeFromCart(item.id)} disabled={isCheckingOut}>✕</button>
					</div>
				  ))}
				</div>

				<div className="bg-white p-5 rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] h-fit sticky top-6">
				  <h3 className="mb-4 pb-3 border-b border-[#eee]">{t('cart.orderSummary')}</h3>
				  <div className="flex justify-between mb-3 text-[#666]">
				    <span>{t('cart.subtotal')}</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  <div className="flex justify-between mb-3 text-[#666]">
					<span>{t('cart.shipping')}</span>
					<span>{t('cart.free')}</span>
				  </div>
				  <div className="flex justify-between mb-3 text-lg font-bold text-[#333] pt-3 border-t border-[#eee]">
					<span>{t('cart.total')}</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  {checkoutError && <p className="text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded p-2.5 mt-3 mb-0 text-sm">{checkoutError}</p>}
				  <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }} onClick={handleCheckout} disabled={isCheckingOut}>
					{isCheckingOut ? t('cart.checkingOut') : t('cart.checkout')}
				  </button>
				  <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px' }} onClick={clearCart} disabled={isCheckingOut}>{t('cart.clearCart')}</button>
				</div>
			  </div>
			  )}
			</div>
		</main>
	);
}
