'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';

import { useCart } from '@/context/CartContext'
import { useAuth } from '@/context/AuthContext';
import OnlineStatus from '@/components/OnlineStatus';
import ChatModal from '@/app/(user)/chat/ChatModal'
import styles from './product.module.css';
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
	description: string;
}

export default function ProductPage({ params }: { params: Promise<{ id: string}> })
{
	const { user: currentUser } = useAuth();
	const { addToCart } = useCart();
	const [chatOpen, setChatOpen] = useState(false);
	const [chatMessages, setChatMessages] = useState<any[]>([]);
	const [chatLoading, setChatLoading] = useState(false);
	const [quantity, setQuantity] = useState(1);
	const resolvedParams = use(params);
	const productId = parseInt(resolvedParams.id);
	const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';
	const defaultAvatarUrl = '/default-avatar.png';
	const placeholderAvatarUrl = 'https://via.placeholder.com/120';

	const [product, setProduct] = useState<Product | null>(null);
	const [imageUrls, setImageUrls] = useState<string[]>([]);
	const [imageIndex, setImageIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const resolveImageUrl = (url?: string) => {
		if (!url)
			return 'https://via.placeholder.com/350x450';
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
			const res = await fetch(`http://localhost:8080/api/v1/messages/${partnerId}`, {
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

	return (
		<main className={styles.main}>
		  <Header/>
		    <div className={styles.productCard}>
		  	  <div className={styles.productImage}>
					<div className={styles.imageFrame}>
						<img
							src={resolveImageUrl(activeImage)}
							alt={product.title || 'Product image'}
						/>
						{canNavigate && (
							<div className={styles.carouselControls}>
								<button
									className={styles.carouselButton}
									onClick={handlePrevImage}
									aria-label="Previous image"
									type="button"
								>
									‹
								</button>
								<span className={styles.carouselCounter}>
									{imageIndex + 1} / {galleryImages.length}
								</span>
								<button
									className={styles.carouselButton}
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

		  	  <div className={styles.productInfo}>
			    <div className={styles.productName}>{product.title}</div>
		  	    <div className={styles.category}> Weight: {product.weightCategory}</div>
				<div className={styles.category}> Flexibility: {product.flexibilityCategory}</div>
				<div className={styles.category}> Balance: {product.balanceCategory}</div>
		  	    <p className="text-muted">{product.reviews} sold</p>
		  	    <p className={styles.price}>${product.price.toFixed(2)} 
				  {product.originalPrice && (
                    <span className={styles.originalPrice}> ${product.originalPrice.toFixed(2)} </span> )}
				</p>
				<div className="quantitySelector">
				  <button className="quantityBtn" onClick={() => setQuantity(prev => Math.max(1, prev - 1))} disabled={quantity <= 1}>-</button>
				    <span className="quantityDisplay">{quantity}</span>
				  <button className="quantityBtn" onClick={() => setQuantity(prev => Math.max(1, prev + 1))}> + </button>
				</div>
		  	    <button className={styles.button} onClick={() => addToCart({id: product.id, title: product.title, price: product.price, image: product.image}, quantity)}>
				  🛒 Add to Cart
				</button>
		  	  </div>
		    </div>

			<div className={styles.shopCard}>
			  <div className={styles.shopImage}>
					<img
						src={resolveAvatarUrl(product.sellerAvatar)}
						alt={product.sellerName ? `${product.sellerName} shop` : 'Shop picture'}
						onError={(event) => {
							(event.currentTarget as HTMLImageElement).src = placeholderAvatarUrl;
						}}
					/>
			  </div>

			  <div className={styles.shopInfo}>
				<div className={styles.shopName}>{product.sellerName}</div>
				<div className={styles.onlineStatus}>{product.sellerId !== undefined && <OnlineStatus userId={product.sellerId} />}</div>
				<div className={styles.shopButtonGroup}>
					<button className={styles.button} onClick={openChat} disabled={chatLoading || !currentUser?.id}>
						{chatLoading ? 'Loading...' : 'Chat Seller'}
					</button>
				  	<Link href={`/user/${product.sellerId}`} className={styles.button}>View Shop</Link>
				</div>
			  </div>

			  <div className={styles.shopAnalytics}>
				<p>-Shop Analytics by Howard/Fadhlul-</p>
			  </div>
			</div>

			<div className={styles.productDescriptionCard}>
				<h3>About this item</h3>
				<p className={styles.description}>{product.description || 'No description provided.'}</p>
				<div className={styles.detailGrid}>
					<div className={styles.detailItem}>
						<span className={styles.detailLabel}>Category</span>
						<span className={styles.detailValue}>{product.category || 'N/A'}</span>
					</div>
					<div className={styles.detailItem}>
						<span className={styles.detailLabel}>Condition</span>
						<span className={styles.detailValue}>{product.condition || 'N/A'}</span>
					</div>
					<div className={styles.detailItem}>
						<span className={styles.detailLabel}>Dealing method</span>
						<span className={styles.detailValue}>{product.dealingMethod || 'N/A'}</span>
					</div>
					<div className={styles.detailItem}>
						<span className={styles.detailLabel}>Location</span>
						<span className={styles.detailValue}>{product.location || 'N/A'}</span>
					</div>
					<div className={styles.detailItem}>
						<span className={styles.detailLabel}>Contact</span>
						<span className={styles.detailValue}>{product.phoneNumber || 'N/A'}</span>
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
// 		<span className={isOnline ? styles.statusOnlineText : styles.statusOfflineText}>
// 		  {showDot && (isOnline ? '●' : '○')}
// 		  {isOnline ? 'Online' : 'Offline'}
// 		</span>
// 	)
// }

//<Link href={`/chat?partner=${product.sellerId}`} className={styles.button}>Chat Seller</Link>

// import { useWebSocketContext } from '@/context/WebSocketContext';
// const { onlineUsers } = useWebSocketContext();