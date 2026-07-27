export default function Footer() {
    return (
      <footer className="bg-[var(--dark)] text-white pt-10 pb-5 mt-10">
        <div className="container">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[30px] mb-[30px]">
            <div>
              <h4 className="text-white mb-3">About Us</h4>
              <ul className="list-none p-0 m-0">
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">About Transcendence</a></li>
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Contact Us</a></li>
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Blog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white mb-3">Support</h4>
              <ul className="list-none p-0 m-0">
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Help Center</a></li>
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Safety Tips</a></li>
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Report Item</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white mb-3">Community</h4>
              <ul className="list-none p-0 m-0">
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Terms &amp; Conditions</a></li>
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Privacy Policy</a></li>
                <li className="mb-2"><a href="#" className="text-[#aaa] no-underline hover:underline">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white mb-3">Follow Us</h4>
              <div className="flex flex-col gap-2">
                <a href="#" className="text-[#aaa] no-underline hover:underline">Facebook</a>
                <a href="#" className="text-[#aaa] no-underline hover:underline">Instagram</a>
                <a href="#" className="text-[#aaa] no-underline hover:underline">Twitter</a>
              </div>
            </div>
          </div>
          <div className="text-center pt-5 border-t border-white/10 text-[#aaa] text-sm">
            <p className="text-[#aaa]">&copy; 2026 RacketDiction. All rights reserved.</p>
          </div>
        </div>
      </footer>
    );
}
