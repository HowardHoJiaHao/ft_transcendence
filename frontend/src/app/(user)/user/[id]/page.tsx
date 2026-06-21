'use client'

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

import Header from '@/components/Header/Header';
import { useToast } from '@/components/Toast/ToastContext';
import { useAuth } from '@/context/AuthContext';;
import ChatModal from '@/app/(user)/chat/ChatModal';
import { useWebSocketContext } from '@/context/WebSocketContext';
import styles from './user.module.css';

interface Product
{
  id: number;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  weightCategory: string;
  flexibilityCategory: string;
  balanceCategory: string;
  location: string;
  sellerId: string;
  sellerName: string;
  rating: number;
  reviews: number;
  isNew: boolean;
  isFeatured: boolean;
}

interface UserProfile {
	id: number;
	username: string;
	email: string;
	firstName?: string;
	lastName?: string;
	phoneNo?: string;
	gender?: string;
	dateOfBirth?: string;
	avatarUrl?: string;
}

interface PrivateMessage {
	type: 'private_message';
	sender_id: number;
	receiver_id: number;
	content: string;
	created_at: string;
	id: number;
}

export default function UserPage()
{
	const { id } = useParams();
	const router = useRouter();
	const { user: currentUser } = useAuth();
	const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
	const defaultAvatarUrl = '/default-avatar.png';
	const placeholderAvatarUrl = 'https://via.placeholder.com/120';
	const placeholderListingImageUrl = 'https://via.placeholder.com/350x450';
	const [seller, setSeller] = useState<UserProfile | null>(null)
	const [products, setProducts] = useState<Product[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [chatOpen, setChatOpen] = useState(false);
	const [chatMessages, setChatMessages] = useState<PrivateMessage[]>([]);
	const [chatLoading, setChatLoading] = useState(false);

	const { showToast } = useToast();
	const { onlineUsers } = useWebSocketContext();
	const resolveAvatarUrl = (url?: string) => {
		if (!url)
			return defaultAvatarUrl;
		if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:'))
			return url;
		if (url.startsWith('/'))
			return `${apiBaseUrl}${url}`;
		return `${apiBaseUrl}/${url}`;
	}
	const resolveListingImageUrl = (url?: string) => {
		if (!url)
			return placeholderListingImageUrl;
		if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:'))
			return url;
		if (url.startsWith('/'))
			return `${apiBaseUrl}${url}`;
		return `${apiBaseUrl}/${url}`;
	}

	const fetchChatHistory = async (partnerId: number) => {
		if (!currentUser?.id) return [];
		try {
			const res = await fetch(`/api/v1/messages/${partnerId}`, {
				headers: {
					'Authorization': `Bearer ${localStorage.getItem('token')}`
				}
			});
			if (!res.ok) throw new Error('Failed to fetch chat messages');
			const data = await res.json();
			return data.messages || [];
		} catch (err) {
			console.error('Failed to fetch chat history:', err);
			return [];
		}
	};

	const openChat = async () => {
		if (!seller?.id || !currentUser?.id) return;
		setChatLoading(true);
		const history = await fetchChatHistory(seller.id);
		setChatMessages(history);
		setChatLoading(false);
		setChatOpen(true);
	};

	const addFriend = async () => {
		if (!seller?.id || !currentUser?.id || seller.id === currentUser.id)
			return;
		try
		{
			const token = localStorage.getItem('token') || `token_${currentUser?.id}`;
			const res = await fetch(`/api/v1/friends/${seller?.id}`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` }
			});
			if (res.ok)
			{
				showToast("Friend added succesfully", "success")
			}
			else
			{
				showToast("Failed to add friend", "error")
			}
		}
		catch(err)
		{
			showToast("Error adding friend", "error")
		}
	}

	useEffect(() => {
		const fetchSeller = async () => {
			try
			{
				setLoading(true)
				const res = await fetch(`/api/v1/users/${id}`)

				if (!res.ok)
					throw new Error(`HTTP error! status: ${res.status}`)

				const data = await res.json();

				setSeller(data);
				showToast('Fetched user successfully', 'success');
			}
			catch (err)
			{
				const errorMsg = err instanceof Error ? err.message : 'Failed to fetch User';
				showToast(errorMsg,'error');
			}
			finally
			{
				setLoading(false);
			}
		}
		if (id)
			fetchSeller();
	}, [id, showToast])

   	useEffect(() =>
	{
		if (!seller)
			return ;
		const fetchProducts = async () =>
		{
		  try
		  {
			setLoading(true);
			setError(null);

			const res = await fetch( `/api/v1/products?sellerId=${seller.id}`);

			if (!res.ok)
			  throw new Error('Failed to fetch products');

			const data = await res.json();
			const mappedProducts = data.products.map((p: any) => ({
			  id: p.id,
			  title: p.title,
			  price: parseFloat(p.price),
			  originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
			  image: p.image,
			  weightCategory: p.weightCategory,
			  flexibilityCategory: p.flexibilityCategory,
			  balanceCategory: p.balanceCategory,
			  location: p.location,
			  sellerId: p.sellerId,
			  sellerName: p.sellerName,
			  rating: parseFloat(p.rating),
			  reviews: p.reviews,
			  isNew: p.isNew,
			  isFeatured: p.isFeatured,
			}));  

			setProducts(mappedProducts);
		  }
		  catch (err)
		  {
			const errorMsg = err instanceof Error ? err.message : 'An unknown error occurred';
			showToast(errorMsg, 'error');
			setProducts([]);
		  } 
		  finally
		  {
			setLoading(false);
		  }
		};

		fetchProducts();
   	}, [seller?.id]);

	return (
	  <main className={styles.main}>
	    <Header/>
		<div className={styles.shopCard}>
		  <div className={styles.shopImage}>
			<img
				src={resolveAvatarUrl(seller?.avatarUrl)}
				alt="-Shop Picture-"
				onError={(event) => {
					(event.currentTarget as HTMLImageElement).src = placeholderAvatarUrl;
				}}
			/>
		  </div>
		  <div className={styles.shopInfo}>
			<div className={styles.shopName}>{seller?.firstName} {seller?.lastName}</div>
			<div className={styles.onlineStatus}>
			  {seller?.id !== undefined && <OnlineStatus userId={seller.id} />}
			</div>
			<div className={styles.shopButtonGroup}>
			  <button className={styles.button} onClick={openChat} disabled={chatLoading || !currentUser?.id}>
			    {chatLoading ? 'Loading...' : 'Chat Seller'}
			  </button>
			  <button className={styles.button} onClick={addFriend} disabled={!currentUser?.id || !seller?.id || seller.id === currentUser.id}>
			    Add Friend
			  </button>
			</div>
		  </div>
		</div>

		<div className={styles.content}>
		  <div className={styles.productsSection}>
           {loading ? (
             <div className={styles.noResults}><p>Loading products...</p></div>
           ) : error ? (
             <div className={styles.noResults}><p>Error: {error}</p>
               <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                 Retry
               </button>
             </div>
           ) : products.length > 0 ? (
             <div className={styles.productsGrid}>
               {products.map((product) => (
                 <div key={product.id} className={styles.productCard}>
                   <div className={styles.productImage}>
                     <img src={product.image} alt={product.title} />
                     {product.isFeatured && (
                       <span className={`badge badge-primary ${styles.badgeFeatured}`}>
                         Featured
                       </span>
                     )}
                     {product.isNew && (
                       <span className={`badge badge-success ${styles.badgeNew}`}>
                         New
                       </span>
                     )}
                   </div>
                   <div className={styles.productBody}>
                     <h4 className={styles.productTitle}>{product.title}</h4>
                     <div className={styles.productMeta}>
                       <span className={styles.location}>📍 {product.location}</span>
                     </div>
                     <div className={styles.productPrice}>
                       <span className="price">RM {product.price}</span>
                       {product.originalPrice && (
                         <span className="price-old">RM {product.originalPrice}</span>
                       )}
                     </div>
                     <div className={styles.productRating}>
                       <span className={styles.stars}>{'⭐'.repeat(Math.floor(product.rating))}</span>
                       <span className={styles.ratingText}>{product.rating} ({product.reviews} reviews)</span>
                     </div>
                     <div className={styles.productSeller}>
                       <span className={styles.sellerName}>{product.sellerName}</span>
                     </div>
                     <Link href={`/products/${product.id}`}>
                       <button className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }} >
                         View Details
                       </button>
                     </Link>
                   </div>
                 </div>
               ))}
             </div>
           ) : (
             <div className={styles.noResults}><p>No products available</p></div>
           )}
       </div>
	  {chatOpen && (
	    <ChatModal partnerId={seller!.id}  messages={chatMessages} onClose={() => setChatOpen(false)}/>
	  )}
	  </div>
	</main>
	)
}

function OnlineStatus({ userId, showDot = true }: { userId: number, showDot?: boolean }) {
	const { onlineUsers } = useWebSocketContext();
	const isOnline = onlineUsers.has(userId);

	return (
		<span className={isOnline ? styles.statusOnlineText : styles.statusOfflineText}>
		  {showDot && (isOnline ? '●' : '○')}
		  {isOnline ? 'Online' : 'Offline'}
		</span>
	)
}
//               {/* Products Grid */}
//               {loading ? (
//                 <div className={styles.noResults}><p>Loading products...</p></div>
//               ) : error ? (
//                 <div className={styles.noResults}><p>Error: {error}</p>
//                   <button className="btn btn-secondary" onClick={() => window.location.reload()}>
//                     Retry
//                   </button>
//                 </div>
//               ) : products.length > 0 ? (
//                 <div className={styles.productsGrid}>
//                   {products.map((product) => (
//                     <div key={product.id} className={styles.productCard}>
//                       <div className={styles.productImage}>
// 							<img
// 								src={resolveListingImageUrl(product.image)}
// 								alt={product.title}
// 								onError={(event) => {
// 									(event.currentTarget as HTMLImageElement).src = placeholderListingImageUrl;
// 								}}
// 							/>
//                         {product.isFeatured && (
//                           <span className={`badge badge-primary ${styles.badgeFeatured}`}>
//                             Featured
//                           </span>
//                         )}
//                         {product.isNew && (
//                           <span className={`badge badge-success ${styles.badgeNew}`}>
//                             New
//                           </span>
//                         )}
//                       </div>
//                       <div className={styles.productBody}>
//                         <h4 className={styles.productTitle}>{product.title}</h4>
//                         <div className={styles.productMeta}>
//                           <span className={styles.location}>📍 {product.location}</span>
//                         </div>
//                         <div className={styles.productPrice}>
//                           <span className="price">RM {product.price}</span>
//                           {product.originalPrice && (
//                             <span className="price-old">RM {product.originalPrice}</span>
//                           )}
//                         </div>
//                         <div className={styles.productRating}>
//                           <span className={styles.stars}>{'⭐'.repeat(Math.floor(product.rating))}</span>
//                           <span className={styles.ratingText}>{product.rating} ({product.reviews} reviews)</span>
//                         </div>
//                         <div className={styles.productSeller}>
//                           <span className={styles.sellerName}>{product.sellerName}</span>
//                         </div>
//                         <Link href={`/products/${product.id}`}>
//                           <button className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }} >
//                             View Details
//                           </button>
//                         </Link>
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               ) : (
//                 <div className={styles.noResults}><p>No products available</p></div>
//               )}
//           </div>
// 		</div>
// 	  </main>
// 	);
// }	
