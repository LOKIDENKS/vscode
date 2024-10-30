const buttons = document.querySelectorAll('button[data-price][data-quantity]');

// Add event listener to each button
buttons.forEach((button) => {
  button.addEventListener('click', (e) => {
    const price = parseInt(button.getAttribute('data-price'));
    const quantity = parseInt(button.getAttribute('data-quantity'));
    const gameType = button.closest('section').classList.contains('vp') ? 'valorant' : 'mobile-legends';
    const itemQuantity = quantity; // This will be used for both games

    // Check if a checkout modal already exists
    const existingModal = document.querySelector('.checkout-wrapper');
    if (existingModal) {
      document.body.removeChild(existingModal);
    }

    // Create a wrapper element for the checkout modal
    const checkoutWrapper = document.createElement('div');
    checkoutWrapper.className = 'checkout-wrapper';

    // Create the checkout modal
    const checkoutModal = document.createElement('div');
    checkoutModal.innerHTML = `
      <h2>Checkout</h2>
      <form>
        <label>Order Quantity:</label>
        <select id="order-quantity">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
        <p>${gameType === 'valorant' ? 'VP' : 'Diamonds'} Quantity: <span id="item-quantity">${itemQuantity} ${gameType === 'valorant' ? 'VP' : 'Diamonds'}</span></p>
        <p>Total: <span id="subtotal">${price} $</span></p>
        <div id="paypal-button-container"></div> <!-- PayPal button -->
      </form>
    `;

    checkoutWrapper.appendChild(checkoutModal);
    document.body.appendChild(checkoutWrapper);

    // Calculate the new quantity and subtotal
    const orderQuantitySelect = document.getElementById('order-quantity');
    orderQuantitySelect.addEventListener('change', (e) => {
      const selectedQuantity = parseInt(orderQuantitySelect.value);
      const newItemQuantity = itemQuantity * selectedQuantity;
      const newSubtotal = price * selectedQuantity;
      document.getElementById('item-quantity').innerText = `${newItemQuantity} ${gameType === 'valorant' ? 'VP' : 'Diamonds'}`;
      document.getElementById('subtotal').innerText = `${newSubtotal} $`;
    });

    // PayPal integration
    paypal.Buttons({
      createOrder: function(data, actions) {
        const selectedQuantity = parseInt(orderQuantitySelect.value);
        const subtotal = price * selectedQuantity;

        return actions.order.create({
          purchase_units: [{
            amount: {
              value: subtotal
            }
          }]
        });
      },
      onApprove: function(data, actions) {
        return actions.order.capture().then(function(details) {
          alert('Transaction completed by ' + details.payer.name.given_name);
          document.body.removeChild(checkoutWrapper); // Remove checkout modal on success
        });
      },
      onCancel: function(data) {
        alert('Payment was canceled.');
      },
      onError: function(err) {
        console.error('Error during payment:', err);
      }
    }).render('#paypal-button-container'); // Render PayPal button in the container
  });
});

// Existing code for game button clicks
document.addEventListener('DOMContentLoaded', () => {
  const valorantButton = document.getElementById('valorant-btn');
  const mobileLegendsButton = document.getElementById('mobile-legends-btn');
  const vpContainer = document.getElementById('vp-container');
  const mbContainer = document.getElementById('mb-container');

  valorantButton.addEventListener('click', (e) => {
    e.preventDefault();
    vpContainer.style.display = 'block';
    mbContainer.style.display = 'none';
  });

  mobileLegendsButton.addEventListener('click', (e) => {
    e.preventDefault();
    mbContainer.style.display = 'block';
    vpContainer.style.display = 'none';
  });
});