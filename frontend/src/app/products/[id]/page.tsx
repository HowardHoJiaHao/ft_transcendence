'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useAuth } from '@/modules/user/components/AuthContext';
import { useWebSocketContext } from '@/context/WebSocketContext'
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
	const { onlineUsers } = useWebSocketContext();
	const [chatOpen, setChatOpen] = useState(false);
	const [chatMessages, setChatMessages] = useState<any[]>([]);
	const [chatLoading, setChatLoading] = useState(false);
	const router = useRouter();
	const resolvedParams = use(params);
	const productId = parseInt(resolvedParams.id);

	const [product, setProduct] = useState<any>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const handleSearch = () => { router.push(`/?search=${encodeURIComponent(searchQuery)}`); }
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
				const res = await fetch(`http://localhost:8080/api/v1/products/${productId}`);
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
		if(!isNaN(productId))
			fetchProduct();
	}, [productId]);

	if (loading) return <div>Loading...</div>;
	if (error) return <div>{error}</div>;
	if (!product) return null;

	return (
		<main className={styles.main}>
		  <Header
		      searchValue={searchQuery}
		      onSearchChange={setSearchQuery}
		      onSearchSubmit={handleSearch}
		  />
		    <div className={styles.productCard}>
		  	  <div className={styles.productImage}>
		  	    <img src={product.image || "https://via.placeholder.com/350x450"} alt="Premium Headphones"></img>
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
		  	    <button className={styles.button}>Add to Cart</button>
		  	  </div>
		    </div>

			<div className={styles.shopCard}>
			  <div className={styles.shopImage}>
				<img src={product.sellerAvatar || "https://via.placeholder.com/350x450"} alt="-Shop Picture-" />
			  </div>

			  <div className={styles.shopInfo}>
				<div className={styles.shopName}>{product.sellerName}</div>
				<div className={styles.onlineStatus}>-Online Status-</div>
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
				<p>{product.description}</p>
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

//<Link href={`/chat?partner=${product.sellerId}`} className={styles.button}>Chat Seller</Link>
