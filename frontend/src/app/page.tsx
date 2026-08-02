'use client';

import { useState, useEffect } from 'react'; //std react hook for managing local state & side effects
import { useAuth } from '@/context/AuthContext';; //import hook to access global authentication data
import { useI18n } from '@/context/LanguageContext';
import Header from '@/components/Header/Header';
import ListingImage from '@/components/ListingImage/ListingImage';
import Link from 'next/link';

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
  stockQuantity: number;
  status: string;
}

const WEIGHT_CATEGORIES = [
  'All',
  '1U',
  '2U',
  '3U',
  '4U',
  '5U',
  '6U',
  '7U',
  '8U',
];

const FLEXIBILITY_CATEGORIES = [
  'All',
  'Stiff Shaft',
  'Medium Flex',
  'High Flexibility',
];

const BALANCE_CATEGORIES = [
  'All',
  'Head Heavy',
  'Even Balance',
  'Head Light',
];

export default function Home()
{
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const [selectedWeights, setSelectedWeights] = useState<string[]>([]);
  const [selectedFlexibilities, setSelectedFlexibilities] = useState<string[]>([]);
  const [selectedBalances, setSelectedBalances] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [products, setProducts] = useState<Product[]>([]); //declare a product array. declare the array is empty
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;

//   const handleSearchWithFilters = (nextSearchQuery: string) => {
//     setSearchQuery(nextSearchQuery);
//   };


  //			SEARH INITIALIZATION (FROM OTHER PAGE SEARCH)
  useEffect(() => {
	const urlSearch = new URLSearchParams(window.location.search).get('search');
	if (urlSearch)
	{
		setSearchInput(urlSearch);
		setSearchQuery(urlSearch);
	}
  }, [])

  //			TYPE SEARCH TRIGGER CD
  useEffect(() => {
	const timeoutId = setTimeout(() => {
		setSearchQuery(searchInput)
	}, 250);

	return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
	setCurrentPage(1)
  }, [selectedWeights, selectedFlexibilities, selectedBalances, searchQuery, sortBy]);


  //			FETCH PRODUCTS FROM API
  //new URLSearchParams(window.location.search) gives search query and get('search') gives value of search key.
  useEffect(() =>
	{
    // const urlSearch = typeof window === 'undefined'
    //             ? null : new URLSearchParams(window.location.search).get('search'); //if the search comes from url (other page), get they word from the key search
    // const currentSearch = urlSearch ?? searchQuery; //if empty, means it dont come from url, use the searchQuery
    // if (urlSearch && urlSearch !== searchQuery) //if both exist but different, means it come from url, update searchQuery following url
    // {
	//   setSearchQuery(urlSearch);
	//   return ;
	// }

    const fetchProducts = async () => {
      try {
        setLoading(true);
        const query = new URLSearchParams();
        if (selectedWeights.length > 0)
		{
			selectedWeights.forEach((w) => {
			query.append('weightCategory', w);
			});
		}
        if (selectedFlexibilities.length > 0)
		{
			selectedFlexibilities.forEach((f) => {
			query.append('flexibilityCategory', f);
			});
		}
		if (selectedBalances.length > 0)
		{
			selectedBalances.forEach((b) => {
			query.append('balanceCategory', b);
			});
		}
        if (searchQuery.trim())
          query.append('search', searchQuery.trim());
        query.append('sort', sortBy);

		const offset = (currentPage - 1) * itemsPerPage;
		query.append('limit', itemsPerPage.toString())
		query.append('offset', offset.toString());

        const res = await fetch(`${apiBaseUrl}/api/v1/products?${query}`);

        if (!res.ok)
          throw new Error('Failed to fetch products');

        const data = await res.json();
        const totalCount = data.total;
		setTotalPages(Math.ceil(totalCount/ itemsPerPage));
        const mappedProducts = data.products.map((p: any) => ({ //for every single data call everything for a while then take the p and turn it into object below
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
          stockQuantity: p.stockQuantity,
          status: p.status,
        }));

        setProducts(mappedProducts);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [selectedWeights, selectedFlexibilities, selectedBalances, searchQuery, sortBy, currentPage]);

  return (
    <main className="flex flex-col min-h-screen px-5">
      {/* Header */}
      <Header
        searchValue={searchInput}
        onSearchChange={setSearchInput}
		onSearchSubmit={() => setSearchQuery(searchInput.trim())}
      />

        {/* Main Content */}
	    <div className="grid grid-cols-[250px_1fr] gap-6 my-6 mx-auto flex-1 max-w-[1200px] w-full px-5 max-[768px]:grid-cols-1">
          {/* Sidebar Filters */}
          <aside className="bg-white p-4 rounded-lg shadow-[var(--shadow)] h-fit top-[100px] max-[768px]:relative max-[768px]:top-0">
            <div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
              <h3 className="text-sm font-semibold mb-3">Price Range</h3>
			  	<div className="flex justify-between text-xs mt-2 text-[var(--secondary)] gap-4">
				  <div className="flex items-center gap-2">
					<input className="placeholder:text-[11px]" type="number" id="minPrice" placeholder="Min" min="0"/>
					<span className="text-base flex items-center justify-center">-</span>
					<input className="placeholder:text-[11px]" type="number" id="maxPrice" placeholder="Max" min="0"/>
				  </div>
                  <button className="px-2.5 py-1">Apply</button>
				</div>
            </div>

			<div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
			  <h3 className="text-sm font-semibold mb-3">Weight</h3>
			    <div className="grid grid-cols-2 gap-2 [&_label]:flex [&_label]:items-center [&_label]:cursor-pointer [&_label]:text-[13px] [&_label]:gap-2 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:cursor-pointer">
				  {WEIGHT_CATEGORIES.filter(c => c !== 'All').map((category) => (
					<label key={category}>
					  <input type="checkbox" value={category} checked={selectedWeights.includes(category)}
						onChange={(e) => {
						  const value = e.target.value;

						  setSelectedWeights((prev) =>
							prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
						  );
						}}
						/>
						{category}
					</label>
				  ))}
				</div>
			</div>

			<div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
				<h3 className="text-sm font-semibold mb-3">Flexibility</h3>
				<div className="flex flex-col gap-2 [&_label]:flex [&_label]:items-center [&_label]:cursor-pointer [&_label]:text-[13px] [&_label]:gap-2 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:cursor-pointer">
					{FLEXIBILITY_CATEGORIES.filter(c => c !== 'All').map((category) => (
						<label key={category}>
							<input type="checkbox" value={category} checked={selectedFlexibilities.includes(category)}
							onChange={(e) => {
								const value = e.target.value;

								setSelectedFlexibilities((prev) =>
									prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
								);
							}}
							/>
							{category}
						</label>
					))}
				</div>
			</div>

			<div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
			  <h3 className="text-sm font-semibold mb-3">Balance</h3>
			    <div className="flex flex-col gap-2 [&_label]:flex [&_label]:items-center [&_label]:cursor-pointer [&_label]:text-[13px] [&_label]:gap-2 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:cursor-pointer">
				  {BALANCE_CATEGORIES.filter(c => c !== 'All').map((category) => (
					<label key={category}>
					  <input type="checkbox" value={category} checked={selectedBalances.includes(category)}
						onChange={(e) => {
						  const value = e.target.value;

						  setSelectedBalances((prev) =>
							prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
						  );
						}}
						/>
						{category}
					</label>
				  ))}
				</div>
			</div>

            <div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
              <h3 className="text-sm font-semibold mb-3">Location</h3>
              <div className="flex flex-col gap-2 [&_label]:flex [&_label]:items-center [&_label]:cursor-pointer [&_label]:text-[13px] [&_label]:gap-2 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:cursor-pointer">
                <label>
                  <input type="checkbox" /> Kuala Lumpur
                </label>
                <label>
                  <input type="checkbox" /> Petaling Jaya
                </label>
                <label>
                  <input type="checkbox" /> Shah Alam
                </label>
                <label>
                  <input type="checkbox" /> All Locations
                </label>
              </div>
            </div>

            <div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
              <h3 className="text-sm font-semibold mb-3">Condition</h3>
              <div className="flex flex-col gap-2 [&_label]:flex [&_label]:items-center [&_label]:cursor-pointer [&_label]:text-[13px] [&_label]:gap-2 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:cursor-pointer">
                <label>
                  <input type="checkbox" defaultChecked /> New
                </label>
                <label>
                  <input type="checkbox" defaultChecked /> Used
                </label>
              </div>
            </div>

            <div className="mb-6 pb-4 border-b border-[var(--border)] last:border-b-0">
              <h3 className="text-sm font-semibold mb-3">Rating</h3>
              <div className="flex flex-col gap-2 [&_label]:flex [&_label]:items-center [&_label]:cursor-pointer [&_label]:text-[13px] [&_label]:gap-2 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:cursor-pointer">
                <label>
                  <input type="checkbox" /> 4.5+ ⭐
                </label>
                <label>
                  <input type="checkbox" /> 4.0+ ⭐
                </label>
                <label>
                  <input type="checkbox" /> 3.5+ ⭐
                </label>
              </div>
            </div>
          </aside>

          {/* Products */}
          <div className="flex-1">
            {/* Sort Controls */}
            <div className="flex justify-between items-center mb-5 px-4 py-3 bg-white rounded text-sm max-[480px]:flex-col max-[480px]:items-start max-[480px]:gap-3">
              <span>{products.length} results found</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-[var(--border)] rounded cursor-pointer text-sm"
              >
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="rating">Highest Rating</option>
              </select>
            </div>

            {/* Products Grid */}
            {loading ? (
              <div className="text-center px-5 py-[60px] bg-white rounded-lg">
                <p className="text-base mb-5">Loading products...</p>
              </div>
            ) : error ? (
              <div className="text-center px-5 py-[60px] bg-white rounded-lg">
                <p className="text-base mb-5">Error: {error}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </button>
              </div>
            ) : products.length > 0 ? (
              <div className="grid grid-cols-4 gap-4 max-[768px]:grid-cols-2">
                {products.map((product) => (
                  <div key={product.id} className={`group bg-white rounded-lg overflow-hidden shadow-[var(--shadow)] transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-[var(--shadow-lg)] ${product.stockQuantity <= 0 || product.status === 'sold' ? 'opacity-85' : ''}`}>
                    <div className="relative w-full h-[200px] overflow-hidden">
                      <ListingImage
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        src={product.image}
                        alt={product.title}
                        apiBase={apiBaseUrl}
                      />
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
                      {(product.stockQuantity <= 0 || product.status === 'sold') && (
                        <span className="absolute bottom-2 right-2 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white">
                          {t('cart.sold')}
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
                        <span className="inline-block tracking-[2px] text-[11px]">
                          {'⭐'.repeat(Math.floor(product.rating))}
                        </span>
                        <span className="text-[var(--secondary)]">
                          {product.rating} ({product.reviews} reviews)
                        </span>
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
              <div className="text-center px-5 py-[60px] bg-white rounded-lg">
                <p className="text-base mb-5">No products found matching your criteria</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedWeights([]);
                    setSelectedFlexibilities([]);
					setSelectedBalances([]);
                  }}
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>

		    {!loading && !error && products.length > 0 && (
			  <div className="flex flex-col justify-center items-center gap-2 mt-6 p-4 bg-white rounded-lg w-fit box-border col-span-full max-w-full mx-auto justify-self-center">
			    <div className="flex justify-center items-center gap-2 flex-nowrap w-fit pb-1">
			      <button className="flex-none px-3 py-2 border rounded cursor-pointer text-sm min-w-9 bg-white border-[var(--border)] enabled:hover:border-[var(--primary)] enabled:hover:text-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1}>
			        ← Prev
				  </button>
				  
				  {/*Page Numbers*/}
				  {[...Array(totalPages)].map((_, i) => (
				    <button key={i + 1} className={`flex-none px-3 py-2 border rounded cursor-pointer text-sm min-w-9 ${currentPage === i + 1 ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white border-[var(--border)] enabled:hover:border-[var(--primary)] enabled:hover:text-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed'}`} onClick={() => setCurrentPage(i + 1)}>
				  	{i + 1}
				    </button>
				  ))}
				  <button className="flex-none px-3 py-2 border rounded cursor-pointer text-sm min-w-9 bg-white border-[var(--border)] enabled:hover:border-[var(--primary)] enabled:hover:text-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages}>
				    Next →
				  </button>
				</div>
				<span className="text-sm text-[var(--secondary)]">
				  Page {currentPage} of {totalPages}
				</span>
			  </div>
			)}
        </div>
    </main>
  );
}
