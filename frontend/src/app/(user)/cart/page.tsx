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
	// Only ever sent for orders the caller placed, so this arrives populated
	// here and nowhere else. Optional because a seller may have published
	// neither a listing contact number nor an account one.
	sellerPhone?: string;
	recommendationSurveySubmitted: boolean;
	listingReviewSubmitted: boolean;
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
	const [reviewOrder, setReviewOrder] = useState<PurchaseOrder | null>(null);
	const [reviewRating, setReviewRating] = useState(0);
	const [reviewComment, setReviewComment] = useState('');
	const [reviewSubmitting, setReviewSubmitting] = useState(false);
	const [paymentMethod, setPaymentMethod] = useState<'meetup' | 'stripe'>('meetup');
	const [stripeCheckoutRequestId, setStripeCheckoutRequestId] = useState('');
	const [stripeReturnState, setStripeReturnState] = useState<'return' | 'cancelled' | null>(null);
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
				orders?: Array<{ id: number }>;
				checkoutUrl?: string;
			};
			if (!res.ok) {
				const message = data.error || t('cart.checkoutFailed');
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
			const createdOrderIDs = (data.orders ?? []).map(order => order.id);
			setRecentCheckoutOrderIDs(createdOrderIDs);
			clearCart();
			setOrdersLoaded(false);
			setActiveTab('purchases');
			showToast(t('cart.checkoutSuccess'), 'success');
		} catch (err) {
			setCheckoutError(t('cart.checkoutNetworkError'));
			showToast(t('cart.checkoutNetworkError'), 'error');
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
	const canReviewOrder = (order: PurchaseOrder) => (
		(order.status === 'pending' || order.status === 'completed') &&
		(order.paymentMethod !== 'stripe' || order.paymentStatus === 'paid')
	);
	const openReview = (order: PurchaseOrder) => {
		setReviewOrder(order);
		setReviewRating(0);
		setReviewComment('');
	};
	const submitReview = async () => {
		if (!reviewOrder || reviewRating < 1 || !reviewComment.trim()) {
			showToast(t('productReviews.validationRequired'), 'error');
			return;
		}
		const token = localStorage.getItem('token');
		if (!token)
			return;
		setReviewSubmitting(true);
		try {
			const response = await fetch(`/api/v1/products/${reviewOrder.listingId}/reviews`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ rating: reviewRating, comment: reviewComment.trim() }),
			});
			const data = await response.json().catch(() => ({})) as { error?: string };
			if (!response.ok)
				throw new Error(data.error || t('productReviews.submitFailed'));
			setOrders(current => current.map(order => (
				order.id === reviewOrder.id ? { ...order, listingReviewSubmitted: true } : order
			)));
			setReviewOrder(null);
			showToast(t('productReviews.submitSuccess'), 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : t('productReviews.submitFailed'), 'error');
		} finally {
			setReviewSubmitting(false);
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
						<ListingImage src={order.listingImage} alt={order.listingTitle} className="w-20 h-20 object-cover rounded-lg"/>
						<div className="flex-1">
							<h3 className="text-base mb-1">{order.listingTitle}</h3>
							<p className="text-[#666] text-[13px] mt-1 mb-0">{t('cart.seller', { name: order.sellerName || t('cart.sellerFallback') })}</p>
							{/* Contact details for an order you actually placed. Rendered
							    as a tel: link so a phone can dial it straight from the
							    purchase, and hidden entirely when the seller published no
							    number rather than showing an empty label. */}
							{order.sellerPhone && (
								<p className="text-[#666] text-[13px] mt-1 mb-0">
									{t('cart.sellerPhone')}{' '}
									<a href={`tel:${order.sellerPhone}`} className="text-[var(--primary)] font-semibold no-underline hover:underline">
										{order.sellerPhone}
									</a>
								</p>
							)}
							<p className="text-[#666] text-[13px] mt-1 mb-0">{t('cart.orderedOn', { date: formatDate(order.createdAt), quantity: order.quantity })}</p>
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
							{(order.status === 'pending' || order.status === 'completed') && (
								order.recommendationSurveySubmitted
									? <span className="text-xs font-semibold text-[#1a7f37]">{t('mlSurvey.submitted')}</span>
									: <button type="button" className="btn btn-secondary" onClick={() => openSurvey(order.id)}>{t('mlSurvey.complete')}</button>
							)}
							{canReviewOrder(order) && (
								order.listingReviewSubmitted
									? <span className="text-xs font-semibold text-[#1a7f37]">{t('productReviews.alreadyReviewed')}</span>
									: <button type="button" className="btn btn-secondary" onClick={() => openReview(order)}>{t('productReviews.writeReview')}</button>
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
				<h1 className="mb-6 text-[#333]">{activeTab === 'cart' ? t('cart.title', { count: items.length }) : t('cart.purchasesTitle')}</h1>
				{stripeReturnState && (
					<div role="status" className="mb-5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4 text-[#1e3a8a]">
						{stripeReturnMessage()}
					</div>
				)}
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
					{isCheckingOut ? t('cart.checkingOut') : t('cart.checkout')}
				  </button>
				  <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px' }} onClick={clearCart} disabled={isCheckingOut}>{t('cart.clearCart')}</button>
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
			{reviewOrder !== null && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="purchase-review-title">
					<div className="w-full max-w-[560px] rounded-xl bg-white p-6 shadow-xl">
						<h2 id="purchase-review-title" className="mt-0">{t('productReviews.writeReview')}</h2>
						<p className="text-sm text-[#666]">{reviewOrder.listingTitle}</p>
						<label className="mb-4 flex flex-col gap-1.5 text-sm font-semibold">
							{t('productReviews.ratingLabel')}
							<select aria-label={t('productReviews.ratingLabel')} value={reviewRating} onChange={event => setReviewRating(Number(event.target.value))} className="rounded-md border border-[#ccc] bg-white px-3 py-2.5 font-normal">
								<option value={0}>{t('mlSurvey.chooseOption')}</option>
								{[1, 2, 3, 4, 5].map(rating => <option key={rating} value={rating}>{rating} / 5</option>)}
							</select>
						</label>
						<label className="flex flex-col gap-1.5 text-sm font-semibold">
							{t('productReviews.commentLabel')}
							<textarea value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder={t('productReviews.commentPlaceholder')} maxLength={1000} rows={5} className="resize-y rounded-md border border-[#ccc] px-3 py-2.5 font-normal" />
						</label>
						<div className="mt-6 flex justify-end gap-2">
							<button type="button" className="btn btn-secondary" disabled={reviewSubmitting} onClick={() => setReviewOrder(null)}>{t('mlSurvey.cancel')}</button>
							<button type="button" className="btn btn-primary" disabled={reviewSubmitting || reviewRating < 1 || !reviewComment.trim()} onClick={() => void submitReview()}>
								{reviewSubmitting ? t('productReviews.submitting') : t('productReviews.submit')}
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
