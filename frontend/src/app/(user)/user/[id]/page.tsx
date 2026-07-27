'use client'

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

import Header from '@/components/Header/Header';
import { useToast } from '@/components/Toast/ToastContext';
import { useAuth } from '@/context/AuthContext';;
import ChatModal from '@/app/(user)/chat/ChatModal';
import { useWebSocketContext } from '@/context/WebSocketContext';

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
	  <main>
	    <Header/>
		<div className="bg-white p-5 rounded-xl shadow-[var(--shadow)] flex w-[90%] max-w-[1138px] h-auto min-h-[150px] my-6 mx-auto gap-[30px]">
		  <div className="flex-[0_0_30%] overflow-hidden rounded-lg">
			<img
				src={resolveAvatarUrl(seller?.avatarUrl)}
				alt="-Shop Picture-"
				onError={(event) => {
					(event.currentTarget as HTMLImageElement).src = placeholderAvatarUrl;
				}}
			/>
		  </div>
		  <div className="flex-[0_0_30%]">
			<div className="mb-2 text-[var(--dark)] font-semibold">{seller?.firstName} {seller?.lastName}</div>
			<div className="mb-2 text-[var(--secondary)] text-sm">
			  {seller?.id !== undefined && <OnlineStatus userId={seller.id} />}
			</div>
			<div className="flex gap-2.5 mt-2">
			  <button className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 hover:bg-[var(--primary-dark)]" onClick={openChat} disabled={chatLoading || !currentUser?.id}>
			    {chatLoading ? 'Loading...' : 'Chat Seller'}
			  </button>
			  <button className="bg-[var(--primary)] text-white border-none px-[25px] py-3 rounded-md cursor-pointer text-base transition-colors duration-300 hover:bg-[var(--primary-dark)]" onClick={addFriend} disabled={!currentUser?.id || !seller?.id || seller.id === currentUser.id}>
			    Add Friend
			  </button>
			</div>
		  </div>
		</div>

		<div className="block my-6 mx-auto max-w-[1200px] w-full px-5">
		  <div>
           {loading ? (
             <div className="text-center px-5 py-[60px] bg-white rounded-lg"><p className="text-base mb-5">Loading products...</p></div>
           ) : error ? (
             <div className="text-center px-5 py-[60px] bg-white rounded-lg"><p className="text-base mb-5">Error: {error}</p>
               <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                 Retry
               </button>
             </div>
           ) : products.length > 0 ? (
             <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
               {products.map((product) => (
                 <div key={product.id} className="group bg-white rounded-lg overflow-hidden shadow-[var(--shadow)] transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]">
                   <div className="relative w-full h-[200px] overflow-hidden">
                     <img src={product.image} alt={product.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                     {product.isFeatured && (
                       <span className="badge badge-primary absolute top-2 left-2 text-[11px] px-2 py-1">
                         Featured
                       </span>
                     )}
                     {product.isNew && (
                       <span className="badge badge-success absolute top-2 right-2 text-[11px] px-2 py-1">
                         New
                       </span>
                     )}
                   </div>
                   <div className="p-3">
                     <h4 className="text-sm font-semibold mb-2 text-[var(--dark)] leading-[1.4] h-[2.8em] overflow-hidden text-ellipsis line-clamp-2">{product.title}</h4>
                     <div className="text-xs text-[var(--secondary)] mb-2">
                       <span className="block whitespace-nowrap overflow-hidden text-ellipsis">📍 {product.location}</span>
                     </div>
                     <div className="mb-2">
                       <span className="price">RM {product.price}</span>
                       {product.originalPrice && (
                         <span className="price-old">RM {product.originalPrice}</span>
                       )}
                     </div>
                     <div className="flex items-center gap-1.5 mb-2 text-xs">
                       <span className="inline-block tracking-[2px] text-[11px]">{'⭐'.repeat(Math.floor(product.rating))}</span>
                       <span className="text-[var(--secondary)]">{product.rating} ({product.reviews} reviews)</span>
                     </div>
                     <div className="py-2 border-t border-[var(--border)] text-xs text-[var(--secondary)]">
                       <span className="font-medium text-[var(--dark)]">{product.sellerName}</span>
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
             <div className="text-center px-5 py-[60px] bg-white rounded-lg"><p className="text-base mb-5">No products available</p></div>
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
		<span className={isOnline ? 'text-[#22c55e]' : 'text-[var(--secondary)]'}>
		  {showDot && (isOnline ? '●' : '○')}
		  {isOnline ? 'Online' : 'Offline'}
		</span>
	)
}
//               {/* Products Grid */}
//               {loading ? (
//                 <div className="text-center px-5 py-[60px] bg-white rounded-lg"><p className="text-base mb-5">Loading products...</p></div>
//               ) : error ? (
//                 <div className="text-center px-5 py-[60px] bg-white rounded-lg"><p className="text-base mb-5">Error: {error}</p>
//                   <button className="btn btn-secondary" onClick={() => window.location.reload()}>
//                     Retry
//                   </button>
//                 </div>
//               ) : products.length > 0 ? (
//                 <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
//                   {products.map((product) => (
//                     <div key={product.id} className="group bg-white rounded-lg overflow-hidden shadow-[var(--shadow)] transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]">
//                       <div className="relative w-full h-[200px] overflow-hidden">
// 							<img
// 								src={resolveListingImageUrl(product.image)}
// 								alt={product.title}
// 								onError={(event) => {
// 									(event.currentTarget as HTMLImageElement).src = placeholderListingImageUrl;
// 								}}
// 							/>
//                         {product.isFeatured && (
//                           <span className="badge badge-primary absolute top-2 left-2 text-[11px] px-2 py-1">
//                             Featured
//                           </span>
//                         )}
//                         {product.isNew && (
//                           <span className="badge badge-success absolute top-2 right-2 text-[11px] px-2 py-1">
//                             New
//                           </span>
//                         )}
//                       </div>
//                       <div className="p-3">
//                         <h4 className="text-sm font-semibold mb-2 text-[var(--dark)] leading-[1.4] h-[2.8em] overflow-hidden text-ellipsis line-clamp-2">{product.title}</h4>
//                         <div className="text-xs text-[var(--secondary)] mb-2">
//                           <span className="block whitespace-nowrap overflow-hidden text-ellipsis">📍 {product.location}</span>
//                         </div>
//                         <div className="mb-2">
//                           <span className="price">RM {product.price}</span>
//                           {product.originalPrice && (
//                             <span className="price-old">RM {product.originalPrice}</span>
//                           )}
//                         </div>
//                         <div className="flex items-center gap-1.5 mb-2 text-xs">
//                           <span className="inline-block tracking-[2px] text-[11px]">{'⭐'.repeat(Math.floor(product.rating))}</span>
//                           <span className="text-[var(--secondary)]">{product.rating} ({product.reviews} reviews)</span>
//                         </div>
//                         <div className="py-2 border-t border-[var(--border)] text-xs text-[var(--secondary)]">
//                           <span className="font-medium text-[var(--dark)]">{product.sellerName}</span>
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
//                 <div className="text-center px-5 py-[60px] bg-white rounded-lg"><p className="text-base mb-5">No products available</p></div>
//               )}
//           </div>
// 		</div>
// 	  </main>
// 	);
// }	
