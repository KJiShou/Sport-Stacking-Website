FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye

# Install Starship
RUN curl -sS https://starship.rs/install.sh | sh -s -- --yes

# Switch to node user
USER node

# Create directory for Starship config
RUN mkdir -p /home/node/.config

# Add Starship init to bash
RUN echo 'eval "$(starship init bash)"' >> /home/node/.bashrc

# Copy Starship configuration
COPY --chown=node:node starship.toml /home/node/.config/starship.toml 
