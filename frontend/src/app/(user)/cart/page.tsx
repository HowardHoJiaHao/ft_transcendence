'use client'

import { useEffect, useState } from 'react'
import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/components/Toast/ToastContext'
import { useI18n } from '@/context/LanguageContext'
import Header from '@/components/Header/Header'
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
	recommendationSurveySubmitted: boolean;
}

type SurveyForm = {
	age_group: string;
	gender: string;
	experience_level: string;
	play_style: string;
	budget_range: string;
};

const EMPTY_SURVEY: SurveyForm = {
	age_group: '',
	gender: '',
	experience_level: '',
	play_style: '',
	budget_range: '',
};

const SURVEY_OPTIONS: Array<{
	key: keyof SurveyForm;
	labelKey: string;
	options: Array<{ value: string; labelKey: string }>;
}> = [
	{
		key: 'age_group',
		labelKey: 'mlSurvey.ageGroup',
		options: [
			{ value: 'under_13', labelKey: 'mlSurvey.under13' },
			{ value: '13-17', labelKey: 'mlSurvey.age13To17' },
			{ value: '18-25', labelKey: 'mlSurvey.age18To25' },
			{ value: '26-35', labelKey: 'mlSurvey.age26To35' },
			{ value: '36-45', labelKey: 'mlSurvey.age36To45' },
			{ value: '46_plus', labelKey: 'mlSurvey.age46Plus' },
		],
	},
	{
		key: 'gender',
		labelKey: 'mlSurvey.gender',
		options: [
			{ value: 'male', labelKey: 'mlSurvey.male' },
			{ value: 'female', labelKey: 'mlSurvey.female' },
			{ value: 'prefer_not_to_say', labelKey: 'mlSurvey.preferNotToSay' },
		],
	},
	{
		key: 'experience_level',
		labelKey: 'mlSurvey.experience',
		options: [
			{ value: 'less_than_6_months', labelKey: 'mlSurvey.lessThan6Months' },
			{ value: '6_months_1_year', labelKey: 'mlSurvey.sixMonthsTo1Year' },
			{ value: '1-3_years', labelKey: 'mlSurvey.oneTo3Years' },
			{ value: '3-5_years', labelKey: 'mlSurvey.threeTo5Years' },
			{ value: 'more_than_5_years', labelKey: 'mlSurvey.moreThan5Years' },
		],
	},
	{
		key: 'play_style',
		labelKey: 'mlSurvey.playStyle',
		options: [
			{ value: 'attacking', labelKey: 'mlSurvey.attacking' },
			{ value: 'defensive', labelKey: 'mlSurvey.defensive' },
			{ value: 'balanced', labelKey: 'mlSurvey.balanced' },
			{ value: 'not_sure', labelKey: 'mlSurvey.notSure' },
		],
	},
	{
		key: 'budget_range',
		labelKey: 'mlSurvey.budget',
		options: [
			{ value: 'under_200', labelKey: 'mlSurvey.under200' },
			{ value: '200-400', labelKey: 'mlSurvey.price200To400' },
			{ value: '400-700', labelKey: 'mlSurvey.price400To700' },
			{ value: '700_plus', labelKey: 'mlSurvey.price700Plus' },
		],
	},
];

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
	const [recentCheckoutOrderIDs, setRecentCheckoutOrderIDs] = useState<number[]>([]);
	const [surveyOrderID, setSurveyOrderID] = useState<number | null>(null);
	const [surveyForm, setSurveyForm] = useState<SurveyForm>(EMPTY_SURVEY);
	const [surveySubmitting, setSurveySubmitting] = useState(false);
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
			const data = await res.json().catch(() => ({})) as {
				error?: string;
				orders?: Array<{ id: number }>;
			};
			if (!res.ok) {
				const message = data.error || 'Checkout failed';
				setCheckoutError(message);
				showToast(message, 'error');
				return;
			}
			const createdOrderIDs = (data.orders ?? []).map(order => order.id);
			setRecentCheckoutOrderIDs(createdOrderIDs);
			clearCart();
			setOrdersLoaded(false);
			setActiveTab('purchases');
			showToast(t('mlSurvey.checkoutSuccess'), 'success');
		} catch (err) {
			setCheckoutError('Network error during checkout');
			showToast('Network error during checkout', 'error');
		} finally {
			setIsCheckingOut(false);
		}
	};

	const openSurvey = (orderID: number) => {
		setSurveyOrderID(orderID);
		setSurveyForm(EMPTY_SURVEY);
	};

	const submitSurvey = async () => {
		if (!surveyOrderID)
			return;
		const token = localStorage.getItem('token');
		if (!token)
			return;
		setSurveySubmitting(true);
		try {
			const response = await fetch(`/api/v1/orders/${surveyOrderID}/recommendation-survey`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(surveyForm),
			});
			const data = await response.json().catch(() => ({})) as { error?: string };
			if (!response.ok)
				throw new Error(data.error || t('mlSurvey.submitFailed'));
			setOrders(current => current.map(order => (
				order.id === surveyOrderID
					? { ...order, recommendationSurveySubmitted: true }
					: order
			)));
			setRecentCheckoutOrderIDs(current => current.filter(id => id !== surveyOrderID));
			setSurveyOrderID(null);
			setSurveyForm(EMPTY_SURVEY);
			showToast(t('mlSurvey.submitSuccess'), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : t('mlSurvey.submitFailed'), 'error');
		} finally {
			setSurveySubmitting(false);
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
				{recentCheckoutOrderIDs.length > 0 && (
					<div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4">
						<p className="m-0 mb-3 font-semibold">{t('mlSurvey.checkoutPrompt')}</p>
						<div className="flex flex-wrap gap-2">
							{recentCheckoutOrderIDs.map(orderID => (
								<button key={orderID} type="button" className="btn btn-primary" onClick={() => openSurvey(orderID)}>
									{t('mlSurvey.completeForOrder', { id: orderID })}
								</button>
							))}
						</div>
					</div>
				)}
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
							<p className="font-bold min-w-20 text-right">RM {order.totalPrice.toFixed(2)}</p>
							{(order.status === 'pending' || order.status === 'completed') && (
								order.recommendationSurveySubmitted
									? <span className="text-xs font-semibold text-[#1a7f37]">{t('mlSurvey.submitted')}</span>
									: <button type="button" className="btn btn-secondary" onClick={() => openSurvey(order.id)}>{t('mlSurvey.complete')}</button>
							)}
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
				  {checkoutError && <p className="text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded p-2.5 mt-3 mb-0 text-sm">{checkoutError}</p>}
				  <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }} onClick={handleCheckout} disabled={isCheckingOut}>
					{isCheckingOut ? 'Checking out...' : 'Checkout'}
				  </button>
				  <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px' }} onClick={clearCart} disabled={isCheckingOut}>Clear cart</button>
				</div>
			  </div>
			  )}
			</div>
			{surveyOrderID !== null && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="ml-survey-title">
					<div className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
						<h2 id="ml-survey-title" className="mt-0">{t('mlSurvey.title', { id: surveyOrderID })}</h2>
						<p className="text-sm text-[#666]">{t('mlSurvey.description')}</p>
						<div className="flex flex-col gap-4">
							{SURVEY_OPTIONS.map(field => (
								<label key={field.key} className="flex flex-col gap-1.5 text-sm font-semibold">
									{t(field.labelKey)}
									<select
										value={surveyForm[field.key]}
										onChange={event => setSurveyForm(current => ({ ...current, [field.key]: event.target.value }))}
										className="rounded-md border border-[#ccc] bg-white px-3 py-2.5 font-normal"
									>
										<option value="">{t('mlSurvey.chooseOption')}</option>
										{field.options.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
									</select>
								</label>
							))}
						</div>
						<div className="mt-6 flex justify-end gap-2">
							<button type="button" className="btn btn-secondary" disabled={surveySubmitting} onClick={() => setSurveyOrderID(null)}>{t('mlSurvey.cancel')}</button>
							<button
								type="button"
								className="btn btn-primary"
								disabled={surveySubmitting || Object.values(surveyForm).some(value => !value)}
								onClick={() => void submitSurvey()}
							>
								{surveySubmitting ? t('mlSurvey.submitting') : t('mlSurvey.submit')}
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
