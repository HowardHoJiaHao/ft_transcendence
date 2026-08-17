'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';
import OnlineStatus from '@/components/OnlineStatus';
import ChatModal from '@/app/(user)/chat/ChatModal'
import Header from '@/components/Header/Header'
import ListingImage from '@/components/ListingImage/ListingImage';
import { resolveListingImageUrl } from '@/lib/listingImage';
import { formatFileSize, type ListingFile } from '@/lib/listingFiles';
import { avatarClass } from '@/lib/avatar';
import { formatLocation } from '@/lib/malaysia';

interface Product {
	id: number;
	sellerId: number;
	sellerName: string;
	sellerAvatar: string;
	title: string;
	weightCategory: string;
	balanceCategory: string;
	flexibilityCategory: string;
	price: number;
	originalPrice: number | null;
	image: string;
	category: string;
	condition: string;
	dealingMethod: string;
	phoneNumber: string;
	location: string;
	state: string;
	rating: number;
	reviews: number;
	isNew: boolean;
	isFeatured: boolean;
	stockQuantity: number;
	status: string;
	description: string;
}

interface ListingReview {
	id: number;
	listingId: number;
	reviewer: {
		id: number;
		username: string;
		avatarUrl?: string;
	};
	rating: number;
	comment: string;
	createdAt: string;
}

interface ListingReviewsResponse {
	reviews: ListingReview[];
	total: number;
	averageRating: number;
	nextOffset: number | null;
}

interface ReviewEligibility {
	canReview: boolean;
	reason?: 'own_listing' | 'already_reviewed' | 'completed_order_required';
}

export default function ProductPage({ params }: { params: Promise<{ id: string}> })
{
	const { user: currentUser } = useAuth();
	const { addToCart, items } = useCart();
	const { showToast } = useToast();
	const { t, lang } = useI18n();
	const [chatOpen, setChatOpen] = useState(false);
	const [chatMessages, setChatMessages] = useState<any[]>([]);
	const [chatLoading, setChatLoading] = useState(false);
	const [quantity, setQuantity] = useState(1);
	const resolvedParams = use(params);
	const productId = parseInt(resolvedParams.id);
	const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
	const defaultAvatarUrl = '/default-avatar.png';
	const placeholderAvatarUrl = defaultAvatarUrl;

	const [product, setProduct] = useState<Product | null>(null);
	const [imageUrls, setImageUrls] = useState<string[]>([]);
	const [listingDocuments, setListingDocuments] = useState<ListingFile[]>([]);
	const [imageIndex, setImageIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [listingReviews, setListingReviews] = useState<ListingReview[]>([]);
	const [reviewTotal, setReviewTotal] = useState(0);
	const [averageReviewRating, setAverageReviewRating] = useState(0);
	const [nextReviewOffset, setNextReviewOffset] = useState<number | null>(null);
	const [reviewsLoading, setReviewsLoading] = useState(true);
	const [reviewsLoadingMore, setReviewsLoadingMore] = useState(false);
	const [reviewsError, setReviewsError] = useState(false);
	const [reviewEligibility, setReviewEligibility] = useState<ReviewEligibility | null>(null);
	const [eligibilityLoading, setEligibilityLoading] = useState(false);
	const [selectedRating, setSelectedRating] = useState(0);
	const [reviewComment, setReviewComment] = useState('');
	const [reviewSubmitting, setReviewSubmitting] = useState(false);

	const resolveImageUrl = (url?: string) => resolveListingImageUrl(url, apiBaseUrl);
	const resolveAvatarUrl = (url?: string) => {
		if (!url)
			return defaultAvatarUrl;
		return resolveImageUrl(url);
	}
	const loadReviews = useCallback(async (offset = 0) => {
		if (offset === 0) setReviewsLoading(true);
		else setReviewsLoadingMore(true);
		setReviewsError(false);
		try {
			const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/reviews?limit=10&offset=${offset}`);
			if (!response.ok) throw new Error('failed to fetch reviews');
			const data = await response.json() as ListingReviewsResponse;
			setListingReviews(previous => offset === 0 ? data.reviews : [...previous, ...data.reviews]);
			setReviewTotal(data.total);
			setAverageReviewRating(data.averageRating);
			setNextReviewOffset(data.nextOffset);
		} catch {
			setReviewsError(true);
		} finally {
			if (offset === 0) setReviewsLoading(false);
			else setReviewsLoadingMore(false);
		}
	}, [apiBaseUrl, productId]);

	const loadReviewEligibility = useCallback(async () => {
		if (!currentUser?.id) {
			setReviewEligibility(null);
			return;
		}
		setEligibilityLoading(true);
		try {
			const token = localStorage.getItem('token');
			const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/review-eligibility`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!response.ok) throw new Error('failed to check review eligibility');
			setReviewEligibility(await response.json() as ReviewEligibility);
		} catch {
			setReviewEligibility({ canReview: false, reason: 'completed_order_required' });
		} finally {
			setEligibilityLoading(false);
		}
	}, [apiBaseUrl, currentUser?.id, productId]);

	//fetch the product
	const fetchChatHistory = async (partnerId: number) => {
		if (!currentUser?.id)
			return[]
		try
		{
			const res = await fetch(`/api/v1/messages/${partnerId}`, {
				headers: {
					'Authorization': `Bearer ${localStorage.getItem('token')}`
				}
			});
			if (!res.ok)
				throw new Error('Failed to fetch chat messages');
			const data = await res.json();
			return data.messages || [];
		}
		catch (err)
		{
			console.error('Failed to fetch chat history:', err);
			return [];
		}
	};

	const openChat = async () => 
	{
		if (!product?.sellerId || !currentUser?.id)
			return ;
		setChatLoading(true);
		const history = await fetchChatHistory(product.sellerId);
		setChatMessages(history);
		setChatLoading(false);
		setChatOpen(true);
	}

	useEffect(() => {
		const fetchProduct = async() => {
			try
			{
				const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
				const res = await fetch(`${apiBaseUrl}/api/v1/products/${productId}`,
					token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
				);
				if (!res.ok)
				{
					if (res.status === 404)
						setError('Product Not Found');
					else
						setError("Failed to fetch product");
					return ;
				}
				const data: Product = await res.json();
				setProduct(data);
			}
			catch (err)
			{
				setError('Network error');
			}
			finally
			{
				setLoading(false);
			}
		};
		const fetchFiles = async () => {
			try {
				const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/files`);
				if (!response.ok) return;
				const data = await response.json();
				const files: ListingFile[] = Array.isArray(data.files) ? data.files : [];
				const images = files
					.filter(file => file.kind === 'image')
					.map(file => file.contentUrl);
				if (images.length > 0) {
					setImageUrls(images);
					setImageIndex(0);
				}
				setListingDocuments(files.filter(file => file.kind === 'document'));
			} catch {
				return;
			}
		};
		if(!isNaN(productId)) {
			fetchProduct();
			fetchFiles();
		}
	}, [productId, apiBaseUrl]);

	useEffect(() => {
		if (!isNaN(productId)) void loadReviews();
	}, [loadReviews, productId]);

	useEffect(() => {
		if (!isNaN(productId)) void loadReviewEligibility();
	}, [loadReviewEligibility, productId]);

	if (loading) return <div>Loading...</div>;
	if (error) return <div>{error}</div>;
	if (!product) return null;

	const galleryImages = imageUrls.length > 0
		? imageUrls
		: product?.image
			? [product.image]
			: [];
	const canNavigate = galleryImages.length > 1;
	const activeImage = galleryImages[imageIndex] || product.image;

	const handlePrevImage = () => {
		if (!canNavigate)
			return;
		setImageIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
	};

	const handleNextImage = () => {
		if (!canNavigate)
			return;
		setImageIndex((prev) => (prev + 1) % galleryImages.length);
	};
	const availableStock = product.stockQuantity ?? 0;
	const cartQuantity = items.find(item => item.id === product.id)?.quantity ?? 0;
	const remainingStock = Math.max(0, availableStock - cartQuantity);
	const isAvailable = product.status === 'active' && availableStock > 0;
	const isOwnListing = currentUser?.id === product.sellerId;
	// Shown beside the photo. Racket-only fields are dropped for categories that
	// do not have them, so shoes and bags are not padded with blank rows.
	const specs = [
		{ label: 'Category', value: product.category },
		{ label: 'Condition', value: product.condition },
		{ label: 'Weight', value: product.weightCategory },
		{ label: 'Flexibility', value: product.flexibilityCategory },
		{ label: 'Balance', value: product.balanceCategory },
		{ label: 'Dealing method', value: product.dealingMethod },
		{ label: 'Location', value: formatLocation(product.location, product.state) },
		{ label: 'Contact', value: product.phoneNumber },
	].filter((spec) => spec.value && spec.value.trim() !== '');
	// A listing is one indivisible lot, so it is either already in the cart or
	// can be added whole -- there is no partial quantity to choose.
	const alreadyInCart = cartQuantity > 0;
	const canAddToCart = isAvailable && !isOwnListing && !alreadyInCart;
	const handleAddToCart = () => {
		if (!canAddToCart) {
			showToast(isOwnListing ? 'You cannot buy your own listing' : alreadyInCart ? 'This listing is already in your cart' : 'This listing is not available', 'error');
			return;
		}
		addToCart({id: product.id, title: product.title, price: product.price, image: product.image}, availableStock);
		showToast('Added to cart', 'success');
	};
	const reviewEligibilityMessage = () => {
		if (!currentUser?.id) return t('productReviews.signInRequired');
		switch (reviewEligibility?.reason) {
			case 'own_listing': return t('productReviews.ownListing');
			case 'already_reviewed': return t('productReviews.alreadyReviewed');
			default: return t('productReviews.completedOrderRequired');
		}
	};
	const handleReviewSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (selectedRating < 1 || !reviewComment.trim()) {
			showToast(t('productReviews.validationRequired'), 'error');
			return;
		}
		setReviewSubmitting(true);
		try {
			const token = localStorage.getItem('token');
			const response = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/reviews`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ rating: selectedRating, comment: reviewComment.trim() }),
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(result.error || t('productReviews.submitFailed'));
			setSelectedRating(0);
			setReviewComment('');
			setReviewEligibility({ canReview: false, reason: 'already_reviewed' });
			showToast(t('productReviews.submitSuccess'), 'success');
			await loadReviews();
		} catch (submitError) {
			showToast(submitError instanceof Error ? submitError.message : t('productReviews.submitFailed'), 'error');
		} finally {
			setReviewSubmitting(false);
		}
	};

	return (
		<main className="flex flex-col min-h-screen px-5 w-full">
		  <Header/>
		    <div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex w-[90%] max-w-[1138px] h-auto min-h-[450px] my-6 mx-auto gap-[30px] max-[600px]:flex-col max-[600px]:m-5">
		  	  <div className="flex-[0_0_50%] overflow-hidden rounded-lg aspect-[4/5] max-h-[520px]">
					<div className="relative w-full h-full">
						<ListingImage
							className="w-full h-full object-cover block"
							src={activeImage}
							alt={product.title || 'Product image'}
							apiBase={apiBaseUrl}
						/>
						{canNavigate && (
							<div className="absolute inset-0 flex items-center justify-between p-3 pointer-events-none">
								<button
									className="pointer-events-auto w-9 h-9 rounded-full border-none bg-black/60 text-white text-xl font-semibold cursor-pointer flex items-center justify-center hover:bg-black/75"
									onClick={handlePrevImage}
									aria-label="Previous image"
									type="button"
								>
									‹
								</button>
								<span className="pointer-events-auto bg-black/55 text-white text-xs px-2.5 py-1.5 rounded-full tracking-[0.4px]">
									{imageIndex + 1} / {galleryImages.length}
								</span>
								<button
									className="pointer-events-auto w-9 h-9 rounded-full border-none bg-black/60 text-white text-xl font-semibold cursor-pointer flex items-center justify-center hover:bg-black/75"
									onClick={handleNextImage}
									aria-label="Next image"
									type="button"
								>
									›
								</button>
							</div>
						)}
					</div>
		  	  </div>

		  	  <div className="flex-[0_0_50%]">
			    {/* Wraps rather than truncating: on the listing's own page the
			        full title is what the buyer came to read. overflow-wrap
			        catches a long unbroken token, which is the only way 40px
			        text can still escape this column. The 3-line clamp is a
			        backstop for rows that predate the 70-character limit; a
			        title within that limit never reaches it. */}
			    <h1
			      title={product.title}
			      className="text-[clamp(26px,3vw,40px)] font-bold text-[var(--dark)] mt-0 mb-2.5 leading-[1.15] break-words [overflow-wrap:anywhere] [text-wrap:balance] [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden"
			    >
			      {product.title}
			    </h1>
				{/* Quantity is shown as a count, matching the marketplace cards.
				    "Unavailable" still covers a listing that has stock but is
				    not active (archived, or reserved by a pending order). The
				    review count is left out — the reviews section further down
				    already carries it. */}
				<p className="text-muted">
				  {!isAvailable
					? (availableStock <= 0 || product.status === 'sold'
						? <span className="font-bold text-red-600">{t('product.sold')}</span>
						: 'Unavailable')
					: <span className="font-bold text-[#1a7f37]">{t('product.quantity', { count: availableStock })}</span>}
				  {alreadyInCart && isAvailable ? ' · in your cart' : ''}
				</p>
		  	    <p className="text-2xl font-bold text-[var(--primary)] mb-5">${product.price.toFixed(2)}
				  {product.originalPrice && (
                    <span className="line-through text-[var(--secondary)] ml-2"> ${product.originalPrice.toFixed(2)} </span> )}
				</p>

				{/* The details a buyer decides on, kept beside the photo instead
				    of only in the About card further down the page. */}
				<dl className="grid grid-cols-2 gap-x-5 gap-y-3 mb-6 pt-4 border-t border-[#eee] m-0">
					{specs.map(({ label, value }) => (
						<div key={label} className="flex flex-col gap-1">
							<dt className="text-[11px] tracking-[1px] uppercase text-[var(--secondary)]">{label}</dt>
							<dd className="text-sm text-[var(--dark)] font-semibold m-0 break-words">{value || 'N/A'}</dd>
						</div>
					))}
				</dl>

				{/* Own listing: buying is impossible, so the slot the cart button
				    occupies is given to the action that is actually useful. */}
				{isOwnListing ? (
					<Link
						href={`/sell?editId=${product.id}`}
						className="inline-flex items-center bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 no-underline hover:bg-[var(--primary-dark)] hover:no-underline"
					>
						✏️ Edit Product Details
					</Link>
				) : (
					<button className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 no-underline hover:bg-[var(--primary-dark)] hover:no-underline disabled:bg-[#9ca3af] disabled:cursor-not-allowed" onClick={handleAddToCart} disabled={!canAddToCart}>
					  {!isAvailable ? 'Unavailable' : alreadyInCart ? 'Already In Cart' : availableStock > 1 ? `🛒 Buy All ${availableStock}` : '🛒 Add to Cart'}
					</button>
				)}
              </div>
		    </div>

			<div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex w-[90%] max-w-[1138px] h-auto min-h-[150px] my-6 mx-auto gap-[30px]">
			  <div className="shrink-0">
					<img
						className={avatarClass('shop', 'border border-[#e8e8e6]')}
						src={resolveAvatarUrl(product.sellerAvatar)}
						alt={product.sellerName ? `${product.sellerName} shop` : 'Shop picture'}
						onError={(event) => {
							(event.currentTarget as HTMLImageElement).src = placeholderAvatarUrl;
						}}
					/>
			  </div>

			  <div className="flex-[0_0_30%]">
				<div className="mb-2 text-[var(--dark)] font-semibold">{product.sellerName}</div>
				<div className="mb-2 text-[var(--secondary)] text-sm">{product.sellerId !== undefined && <OnlineStatus userId={product.sellerId} />}</div>
				<div className="flex gap-2.5 mt-2">
					<button className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 no-underline hover:bg-[var(--primary-dark)] hover:no-underline disabled:bg-[#9ca3af] disabled:cursor-not-allowed" onClick={openChat} disabled={chatLoading || !currentUser?.id}>
						{chatLoading ? 'Loading...' : 'Chat Seller'}
					</button>
				  	<Link href={`/user/${product.sellerId}`} className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 no-underline hover:bg-[var(--primary-dark)] hover:no-underline disabled:bg-[#9ca3af] disabled:cursor-not-allowed">View Shop</Link>
				</div>
			  </div>
			</div>

			<div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex flex-col w-[90%] max-w-[1138px] h-auto min-h-[450px] my-6 mx-auto gap-[30px] break-words leading-[1.6]">
				{/* Specs now sit beside the photo; this card carries the prose. */}
				<h3>About this item</h3>
				<p className="text-[var(--secondary)] leading-[1.6] mb-[25px]">{product.description || 'No description provided.'}</p>
			</div>

			{listingDocuments.length > 0 && (
				<section
					className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex flex-col w-[90%] max-w-[1138px] h-auto my-6 mx-auto gap-3"
					aria-labelledby="listing-documents-heading"
				>
					<div>
						<h2 id="listing-documents-heading" className="m-0 text-xl text-[var(--dark)]">
							{t('listingFiles.publicTitle')}
						</h2>
						<p className="m-0 mt-1 text-sm text-[var(--secondary)]">
							{t('listingFiles.publicHint')}
						</p>
					</div>
					{listingDocuments.map(document => (
						<div
							key={document.id}
							className="flex items-center gap-3 border border-[#e2e8f0] bg-[#f8fafc] rounded-lg px-4 py-3"
						>
							<span className="text-2xl" aria-hidden="true">📄</span>
							<div className="min-w-0 flex-1">
								<p className="m-0 text-sm font-semibold text-[var(--dark)] truncate">
									{document.originalName}
								</p>
								<p className="m-0 mt-0.5 text-xs text-[var(--secondary)]">
									PDF · {formatFileSize(document.size)}
								</p>
							</div>
							<a
								href={document.contentUrl}
								target="_blank"
								rel="noreferrer"
								className="text-[var(--primary)] text-sm font-semibold no-underline hover:underline"
							>
								{t('listingFiles.preview')}
							</a>
							<a
								href={`${document.contentUrl}?download=1`}
								download={document.originalName}
								className="text-[var(--primary)] text-sm font-semibold no-underline hover:underline"
							>
								{t('listingFiles.download')}
							</a>
						</div>
					))}
				</section>
			)}

			<section className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex flex-col w-[90%] max-w-[1138px] h-auto my-6 mx-auto gap-5 break-words" aria-labelledby="product-reviews-heading">
				<div className="flex items-start justify-between gap-4 max-[600px]:flex-col">
					<div>
						<h2 id="product-reviews-heading" className="m-0 text-xl text-[var(--dark)]">{t('productReviews.title')}</h2>
						<p className="m-0 mt-1 text-sm text-[var(--secondary)]">
							{reviewTotal > 0
								? t('productReviews.summary', { rating: averageReviewRating.toFixed(1), count: reviewTotal })
								: t('productReviews.noRatings')}
						</p>
					</div>
					{reviewTotal > 0 && (
						<span className="text-lg tracking-wide text-[#f59e0b]" aria-label={t('productReviews.averageAria', { rating: averageReviewRating.toFixed(1) })}>
							{'★'.repeat(Math.round(averageReviewRating))}{'☆'.repeat(5 - Math.round(averageReviewRating))}
						</span>
					)}
				</div>

				{currentUser?.id && eligibilityLoading && (
					<p className="m-0 text-sm text-[var(--secondary)]">{t('productReviews.checkingEligibility')}</p>
				)}
				{currentUser?.id && !eligibilityLoading && reviewEligibility?.canReview && (
					<form onSubmit={handleReviewSubmit} className="border border-[#e5e7eb] rounded-lg p-4 bg-[#fafafa] flex flex-col gap-3">
						<h3 className="m-0 text-base text-[var(--dark)]">{t('productReviews.writeReview')}</h3>
						<div role="radiogroup" aria-label={t('productReviews.ratingLabel')} className="flex gap-1">
							{[1, 2, 3, 4, 5].map(star => (
								<button
									key={star}
									type="button"
									role="radio"
									aria-checked={selectedRating === star}
									aria-label={t('productReviews.starOption', { count: star })}
									onClick={() => setSelectedRating(star)}
									className={`border-0 bg-transparent p-0 text-2xl cursor-pointer ${star <= selectedRating ? 'text-[#f59e0b]' : 'text-[#d1d5db]'}`}
								>
									★
								</button>
							))}
						</div>
						<label className="flex flex-col gap-1.5 text-sm font-semibold text-[var(--dark)]">
							{t('productReviews.commentLabel')}
							<textarea
								value={reviewComment}
								onChange={event => setReviewComment(event.target.value.slice(0, 1000))}
								maxLength={1000}
								required
								rows={4}
								placeholder={t('productReviews.commentPlaceholder')}
								className="resize-y border border-[#d1d5db] rounded-md p-2.5 text-sm font-normal focus:outline-none focus:border-[var(--primary)]"
							/>
						</label>
						<div className="flex items-center justify-between gap-3 max-[480px]:flex-col max-[480px]:items-start">
							<span className="text-xs text-[var(--secondary)]">{t('productReviews.characterCount', { count: reviewComment.length, max: 1000 })}</span>
							<button type="submit" disabled={reviewSubmitting} className="bg-[var(--primary)] text-white border-none px-4 py-2 rounded-md cursor-pointer text-sm disabled:bg-[#9ca3af] disabled:cursor-not-allowed">
								{reviewSubmitting ? t('productReviews.submitting') : t('productReviews.submit')}
							</button>
						</div>
					</form>
				)}
				{!currentUser?.id ? (
					<p className="m-0 text-sm text-[var(--secondary)]">
						{t('productReviews.signInRequired')} <Link href="/login" className="text-[var(--primary)] font-semibold">{t('productReviews.signIn')}</Link>
					</p>
				) : !eligibilityLoading && !reviewEligibility?.canReview && (
					<p className="m-0 text-sm text-[var(--secondary)]">{reviewEligibilityMessage()}</p>
				)}

				{reviewsLoading ? (
					<p className="m-0 py-6 text-center text-sm text-[var(--secondary)]">{t('productReviews.loading')}</p>
				) : reviewsError ? (
					<div className="py-6 text-center">
						<p className="m-0 mb-3 text-sm text-red-700">{t('productReviews.loadFailed')}</p>
						<button type="button" onClick={() => void loadReviews()} className="btn btn-secondary btn-sm">{t('productReviews.retry')}</button>
					</div>
				) : listingReviews.length === 0 ? (
					<p className="m-0 py-6 text-center text-sm text-[var(--secondary)]">{t('productReviews.empty')}</p>
				) : (
					<div className="flex flex-col divide-y divide-[#eeeeec]">
						{listingReviews.map(review => (
							<article key={review.id} className="py-4 first:pt-0 last:pb-0 flex gap-3">
								<img
									src={resolveAvatarUrl(review.reviewer.avatarUrl)}
									alt=""
									className={avatarClass('list')}
									onError={event => { event.currentTarget.src = defaultAvatarUrl; }}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex gap-2 items-center flex-wrap">
										<Link href={`/user/${review.reviewer.id}`} className="font-semibold text-sm text-[var(--dark)] no-underline hover:underline">{review.reviewer.username}</Link>
										<span className="text-sm tracking-wide text-[#f59e0b]" aria-label={t('productReviews.reviewRatingAria', { rating: review.rating })}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
										<time dateTime={review.createdAt} className="text-xs text-[var(--secondary)]">{new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(review.createdAt))}</time>
									</div>
									<p className="m-0 mt-1.5 whitespace-pre-wrap text-sm text-[var(--secondary)]">{review.comment}</p>
								</div>
							</article>
						))}
					</div>
				)}
				{!reviewsLoading && !reviewsError && listingReviews.length > 0 && (
					<div className="text-center pt-1">
						{nextReviewOffset !== null ? (
							<button type="button" disabled={reviewsLoadingMore} onClick={() => void loadReviews(nextReviewOffset)} className="bg-transparent border-0 text-[var(--primary)] font-semibold text-sm cursor-pointer disabled:opacity-50">
								{reviewsLoadingMore ? t('productReviews.loadingMore') : t('productReviews.loadMore')}
							</button>
						) : <span className="text-xs text-[var(--secondary)]">{t('productReviews.end')}</span>}
					</div>
				)}
			</section>

		{chatOpen && product && (
			<ChatModal
				partner={{ id: product.sellerId, username: product.sellerName, avatarUrl: product.sellerAvatar }}
				messages={chatMessages}
				onClose={() => setChatOpen(false)}
			/>
		)}
		</main>
	);
}
