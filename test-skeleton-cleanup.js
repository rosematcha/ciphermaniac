// Simple test to verify skeleton cleanup functionality
console.log('Testing skeleton cleanup...');

// Create a mock card with skeleton elements
const testCard = document.createElement('article');
testCard.className = 'card skeleton-card';
testCard.setAttribute('aria-hidden', 'true');
testCard.innerHTML = `
  <div class="thumb skeleton-loading">
    <div class="skeleton-img"></div>
    <div class="overlay">
      <div class="hist">
        <div class="skeleton-bar"></div>
        <div class="skeleton-bar"></div>
      </div>
      <div class="usagebar">
        <div class="skeleton-usage-bar"></div>
        <span class="skeleton-text small"></span>
      </div>
    </div>
  </div>
  <div class="titleRow">
    <div class="name skeleton-text"></div>
    <div class="counts skeleton-text"></div>
  </div>
`;

document.body.appendChild(testCard);

// Test the cleanup functions
const mockCardData = {
  name: 'Test Card',
  found: 5,
  total: 10,
  pct: 50,
  dist: []
};

// Import the cleanup logic (simulate what the render functions do)
function testSkeletonCleanup() {
  // Test image cleanup
  const thumb = testCard.querySelector('.thumb');
  const skeletonImg = thumb.querySelector('.skeleton-img');
  if (skeletonImg) {
    skeletonImg.remove();
    console.log('✅ Skeleton image removed');
  }
  thumb.classList.remove('skeleton-loading');
  console.log('✅ Skeleton-loading class removed from thumb');

  // Test card cleanup
  testCard.classList.remove('skeleton-card');
  testCard.removeAttribute('aria-hidden');
  console.log('✅ Skeleton-card class and aria-hidden removed');

  // Test text cleanup
  const nameEl = testCard.querySelector('.name');
  nameEl.querySelectorAll('.skeleton-text').forEach(s => s.remove());
  nameEl.classList.remove('skeleton-text');
  nameEl.textContent = mockCardData.name;
  console.log('✅ Name skeleton cleaned and content set');

  // Test counts cleanup
  const counts = testCard.querySelector('.counts');
  counts.querySelectorAll('.skeleton-text').forEach(s => s.remove());
  counts.classList.remove('skeleton-text');
  counts.innerHTML = '<span>5 / 10 decks</span>';
  console.log('✅ Counts skeleton cleaned and content set');

  // Test histogram cleanup
  const hist = testCard.querySelector('.hist');
  hist.querySelectorAll('.skeleton-bar').forEach(s => s.remove());
  hist.classList.remove('skeleton-loading');
  console.log('✅ Histogram skeleton bars removed');

  // Test usage bar cleanup
  const pctEl = testCard.querySelector('.pct');
  if (pctEl) {
    pctEl.querySelectorAll('.skeleton-text').forEach(s => s.remove());
    pctEl.classList.remove('skeleton-text', 'small');
    pctEl.textContent = '50.0%';
    console.log('✅ Usage percentage skeleton cleaned');
  }
}

// Run the test
testSkeletonCleanup();

// Check final state
const hasSkeletonElements = testCard.querySelectorAll('.skeleton-img, .skeleton-text, .skeleton-bar, .skeleton-usage-bar').length > 0;
const hasSkeletonClasses = testCard.classList.contains('skeleton-card') || 
  testCard.querySelector('.skeleton-loading') !== null;

if (!hasSkeletonElements && !hasSkeletonClasses) {
  console.log('🎉 SUCCESS: All skeleton elements and classes removed!');
} else {
  console.log('❌ FAILURE: Some skeleton elements or classes remain:', {
    skeletonElements: testCard.querySelectorAll('.skeleton-img, .skeleton-text, .skeleton-bar, .skeleton-usage-bar').length,
    skeletonClasses: hasSkeletonClasses
  });
}

// Clean up test
testCard.remove();
