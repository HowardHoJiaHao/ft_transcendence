'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';

import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast/ToastContext';
import OnlineStatus from '@/components/OnlineStatus';
import ChatModal from '@/app/(user)/chat/ChatModal'
import Header from '@/components/Header/Header'

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
	rating: number;
	reviews: number;
	isNew: boolean;
	isFeatured: boolean;
	stockQuantity: number;
	status: string;
	description: string;
}

export default function ProductPage({ params }: { params: Promise<{ id: string}> })
{
	const { user: currentUser } = useAuth();
	const { addToCart, items } = useCart();
	const { showToast } = useToast();
	const [chatOpen, setChatOpen] = useState(false);
	const [chatMessages, setChatMessages] = useState<any[]>([]);
	const [chatLoading, setChatLoading] = useState(false);
	const [quantity, setQuantity] = useState(1);
	const resolvedParams = use(params);
	const productId = parseInt(resolvedParams.id);
	const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
	const defaultAvatarUrl = '/default-avatar.png';
	const placeholderAvatarUrl = 'https://via.placeholder.com/120';
	const placeholderListingImageUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='700' height='900' viewBox='0 0 700 900'%3E%3Crect width='700' height='900' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='Arial,sans-serif' font-size='32'%3ENo image%3C/text%3E%3C/svg%3E";

	const [product, setProduct] = useState<Product | null>(null);
	const [imageUrls, setImageUrls] = useState<string[]>([]);
	const [imageIndex, setImageIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const resolveImageUrl = (url?: string) => {
		if (!url)
			return placeholderListingImageUrl;
		if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:'))
			return url;
		if (url.startsWith('/'))
			return `${apiBaseUrl}${url}`;
		return `${apiBaseUrl}/${url}`;
	}
	const resolveAvatarUrl = (url?: string) => {
		if (!url)
			return defaultAvatarUrl;
		return resolveImageUrl(url);
	}

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
				const res = await fetch(`${apiBaseUrl}/api/v1/products/${productId}`);
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
		const fetchImages = async () => {
			try {
				const res = await fetch(`${apiBaseUrl}/api/v1/products/${productId}/images`);
				if (!res.ok)
					return;
				const data = await res.json();
				if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
					setImageUrls(data.imageUrls);
					setImageIndex(0);
				}
			} catch (err) {
				return;
			}
		};
		if(!isNaN(productId)) {
			fetchProduct();
			fetchImages();
		}
	}, [productId, apiBaseUrl]);

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
	const canAddToCart = isAvailable && !isOwnListing && remainingStock > 0;
	const handleAddToCart = () => {
		if (!canAddToCart) {
			showToast(isOwnListing ? 'You cannot buy your own listing' : remainingStock <= 0 ? 'All available stock is already in your cart' : 'This listing is not available', 'error');
			return;
		}
		addToCart({id: product.id, title: product.title, price: product.price, image: product.image}, Math.min(quantity, remainingStock));
		showToast('Added to cart', 'success');
	};

	return (
		<main className="flex flex-col min-h-screen px-5 w-full">
		  <Header/>
		    <div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex w-[90%] max-w-[1138px] h-auto min-h-[450px] my-6 mx-auto gap-[30px] max-[600px]:flex-col max-[600px]:m-5">
		  	  <div className="flex-[0_0_50%] overflow-hidden rounded-lg aspect-[4/5] max-h-[520px]">
					<div className="relative w-full h-full">
						<img
							className="w-full h-full object-cover block"
							src={resolveImageUrl(activeImage)}
							alt={product.title || 'Product image'}
							onError={(event) => {
								(event.currentTarget as HTMLImageElement).src = placeholderListingImageUrl;
							}}
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
			    <div className="text-[40px] font-bold text-[var(--dark)] mb-2.5">{product.title}</div>
		  	    <div className="uppercase text-[var(--secondary)] tracking-[1px] text-xs mb-2.5"> Weight: {product.weightCategory}</div>
				<div className="uppercase text-[var(--secondary)] tracking-[1px] text-xs mb-2.5"> Flexibility: {product.flexibilityCategory}</div>
				<div className="uppercase text-[var(--secondary)] tracking-[1px] text-xs mb-2.5"> Balance: {product.balanceCategory}</div>
		  	    <p className="text-muted">{product.reviews} sold</p>
				<p className="text-muted">
				  {isAvailable ? `${availableStock} in stock` : 'Unavailable'}
				  {cartQuantity > 0 && isAvailable ? ` (${cartQuantity} in cart)` : ''}
				</p>
		  	    <p className="text-2xl font-bold text-[var(--primary)] mb-5">${product.price.toFixed(2)} 
				  {product.originalPrice && (
                    <span className="line-through text-[var(--secondary)] ml-2"> ${product.originalPrice.toFixed(2)} </span> )}
				</p>
                <div className="quantitySelector">
                  <button className="quantityBtn" onClick={() => setQuantity(prev => Math.max(1, prev - 1))} disabled={quantity <= 1}>-</button>
                  <span className="quantityDisplay">{quantity}</span>
                  <button className="quantityBtn" onClick={() => setQuantity(prev => Math.min(remainingStock, prev + 1))} disabled={!canAddToCart || quantity >= remainingStock}> + </button>
                </div>
                <button className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 no-underline hover:bg-[var(--primary-dark)] hover:no-underline disabled:bg-[#9ca3af] disabled:cursor-not-allowed" onClick={handleAddToCart} disabled={!canAddToCart}>
                  {isOwnListing ? 'Your Listing' : remainingStock <= 0 && isAvailable ? 'All Stock In Cart' : isAvailable ? '🛒 Add to Cart' : 'Unavailable'}
                </button>
              </div>
		    </div>

			<div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex w-[90%] max-w-[1138px] h-auto min-h-[150px] my-6 mx-auto gap-[30px]">
			  <div className="flex-[0_0_30%] overflow-hidden rounded-lg aspect-square max-h-[160px]">
					<img
						className="w-full h-full object-cover block"
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

			  <div className="flex-[0_0_40%]">
				<p>-Shop Analytics by Howard/Fadhlul-</p>
			  </div>
			</div>

			<div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex flex-col w-[90%] max-w-[1138px] h-auto min-h-[450px] my-6 mx-auto gap-[30px] break-words leading-[1.6]">
				<h3>About this item</h3>
				<p className="text-[var(--secondary)] leading-[1.6] mb-[25px]">{product.description || 'No description provided.'}</p>
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-6 gap-y-4">
					<div className="flex flex-col gap-1.5">
						<span className="text-xs tracking-[1px] uppercase text-[var(--secondary)]">Category</span>
						<span className="text-sm text-[var(--dark)] font-semibold">{product.category || 'N/A'}</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-xs tracking-[1px] uppercase text-[var(--secondary)]">Condition</span>
						<span className="text-sm text-[var(--dark)] font-semibold">{product.condition || 'N/A'}</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-xs tracking-[1px] uppercase text-[var(--secondary)]">Dealing method</span>
						<span className="text-sm text-[var(--dark)] font-semibold">{product.dealingMethod || 'N/A'}</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-xs tracking-[1px] uppercase text-[var(--secondary)]">Location</span>
						<span className="text-sm text-[var(--dark)] font-semibold">{product.location || 'N/A'}</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-xs tracking-[1px] uppercase text-[var(--secondary)]">Contact</span>
						<span className="text-sm text-[var(--dark)] font-semibold">{product.phoneNumber || 'N/A'}</span>
					</div>
				</div>
			</div>

		{chatOpen && product && (
			<ChatModal
				partnerId={product.sellerId}
				messages={chatMessages}
				onClose={() => setChatOpen(false)}
			/>
		)}
		</main>
	);
}

// function OnlineStatus({ userId, showDot = true }: { userId: number, showDot?: boolean }) {
// 	const { onlineUsers } = useWebSocketContext();
// 	const isOnline = onlineUsers.has(userId);

// 	return (
// 		<span className={isOnline ? 'text-[#22c55e]' : 'text-[var(--secondary)]'}>
// 		  {showDot && (isOnline ? '●' : '○')}
// 		  {isOnline ? 'Online' : 'Offline'}
// 		</span>
// 	)
// }

//<Link href={`/chat?partner=${product.sellerId}`} className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 no-underline hover:bg-[var(--primary-dark)] hover:no-underline disabled:bg-[#9ca3af] disabled:cursor-not-allowed">Chat Seller</Link>

// import { useWebSocketContext } from '@/context/WebSocketContext';
// const { onlineUsers } = useWebSocketContext();
