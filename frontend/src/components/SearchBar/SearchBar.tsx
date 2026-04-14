'use client';

import styles from './SearchBar.module.css';

export default function SearchBar( { //taking variables to destructure them. so later can call these variables directly instead of props.
  value,
  onChange,
  onSubmit,
}: { //specify the types
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className={styles.searchContainer}>
      <div className={styles.searchBox}>
        <input
          type="text"
          placeholder="Search listings, items, sellers..."
          value={value} //when you type yonex the value must be the same
          onChange={(event) => onChange(event.target.value)} //onChange={(event) is the standard event listener
          //onChange(event.target.value)} is the value of string. event.target is the input box. event.target.value is the current string inside the box
          className={styles.searchInput}
        />
        <button type="button" className="btn btn-primary" onClick={onSubmit}>
          Search
        </button>
      </div>
    </div>
  );
}

//  </div
//   {/* Weight Categories */}
//   <div className={styles.categoriesNav}>
//     {WEIGHT_CATEGORIES.map((category) => (
//       <button
//         key={category}
//         className={`${styles.categoryBtn} ${
//           selectedWeightCategory === category ? styles.active : ''
//         }`}
//         onClick={() => setSelectedWeightCategory(category)}
//       >
//         {category}
//       </button>
//     ))}
//   </div
//   {/* Flexibility Categories */}
//   <div className={styles.categoriesNav}>
//     {FLEXIBILITY_CATEGORIES.map((category) => (
//       <button
//         key={category}
//         className={`${styles.categoryBtn} ${
//           selectedFlexibilityCategory === category ? styles.active : ''
//         }`}
//         onClick={() => setSelectedFlexibilityCategory(category)}
//       >
//         {category}
//       </button>
//     ))}
//   </div
//   {/* Balance Categories */}
//   <div className={styles.categoriesNav}>
//     {BALANCE_CATEGORIES.map((category) => (
//       <button
//         key={category}
//         className={`${styles.categoryBtn} ${
//           selectedBalanceCategory === category ? styles.active : ''
//         }`}
//         onClick={() => setSelectedBalanceCategory(category)}
//       >
//         {category}
//       </button>
//     ))}
//   </div>
// }