# syntax=docker/dockerfile:1.7
FROM ubuntu:24.04 AS native-build

ARG DEBIAN_FRONTEND=noninteractive
ARG OCCT_REVISION=a016080bf6738d6aeae020badee4e888ad1540a5
ARG NETGEN_REVISION=a3e08f0ec196b442f7de3b9b717ab86c6993f1ab
ARG MFEM_REVISION=d9d6526cc1749980a2ba1da16e2c1ca1e07d82ec

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    libblas-dev \
    libeigen3-dev \
    libfreetype-dev \
    libgl1-mesa-dev \
    liblapack-dev \
    libmetis-dev \
    libx11-dev \
    libxext-dev \
    libxmu-dev \
    ninja-build \
    rapidjson-dev \
    tcl-dev \
    tk-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
ENV LD_LIBRARY_PATH=/opt/cad-fem/lib:/opt/cad-fem/lib64
ENV OCCT_RESOURCE_PATH=/opt/cad-fem/share/opencascade/resources
ENV CSF_OCCTResourcePath=/opt/cad-fem/share/opencascade/resources
ENV CSF_PluginDefaults=/opt/cad-fem/share/opencascade/resources
ENV CSF_StandardDefaults=/opt/cad-fem/share/opencascade/resources
ENV CSF_XCAFDefaults=/opt/cad-fem/share/opencascade/resources
ENV CSF_ResourcesDefaults=/opt/cad-fem/share/opencascade/resources
RUN git clone --filter=blob:none https://github.com/Open-Cascade-SAS/OCCT.git occt \
  && git -C occt checkout "${OCCT_REVISION}" \
  && cmake -S occt -B /build/occt -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/cad-fem \
      -DBUILD_LIBRARY_TYPE=Shared \
      -DBUILD_MODULE_Draw=OFF \
      -DBUILD_DOC_Overview=OFF \
      -DBUILD_SAMPLES_QT=OFF \
      -DBUILD_SHARED_LIBS=ON \
      -DUSE_TBB=OFF \
  && cmake --build /build/occt --parallel \
  && cmake --install /build/occt

RUN git clone --filter=blob:none --recurse-submodules https://github.com/NGSolve/netgen.git netgen \
  && git -C netgen checkout "${NETGEN_REVISION}" \
  && git -C netgen submodule update --init --recursive \
  && cmake -S netgen -B /build/netgen -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/cad-fem \
      -DCMAKE_PREFIX_PATH=/opt/cad-fem \
      -DUSE_SUPERBUILD=OFF \
      -DUSE_NATIVE_ARCH=OFF \
      -DUSE_GUI=OFF \
      -DUSE_PYTHON=OFF \
      -DUSE_MPI=OFF \
      -DUSE_OCC=ON \
      -DNGLIB_LIBRARY_TYPE=SHARED \
      -DNGCORE_LIBRARY_TYPE=SHARED \
      -DBUILD_TESTING=OFF \
  && cmake --build /build/netgen --parallel \
  && cmake --install /build/netgen

RUN git clone --filter=blob:none https://github.com/mfem/mfem.git mfem \
  && git -C mfem checkout "${MFEM_REVISION}" \
  && cmake -S mfem -B /build/mfem -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/cad-fem \
      -DBUILD_SHARED_LIBS=ON \
      -DMFEM_USE_MPI=OFF \
      -DMFEM_USE_METIS=ON \
      -DMFEM_BUILD_EXAMPLES=OFF \
      -DMFEM_BUILD_MINIAPPS=OFF \
      -DMFEM_ENABLE_TESTING=OFF \
  && cmake --build /build/mfem --parallel \
  && cmake --install /build/mfem

RUN install -D /src/occt/LICENSE_LGPL_21.txt /opt/cad-fem/share/licenses/occt/LICENSE_LGPL_21.txt \
  && install -D /src/occt/OCCT_LGPL_EXCEPTION.txt /opt/cad-fem/share/licenses/occt/OCCT_LGPL_EXCEPTION.txt \
  && install -D /src/netgen/LICENSE /opt/cad-fem/share/licenses/netgen/LICENSE \
  && install -D /src/mfem/LICENSE /opt/cad-fem/share/licenses/mfem/LICENSE

COPY . /src/cad-fem-native
RUN cmake -S /src/cad-fem-native -B /build/cad-fem-native -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_PREFIX_PATH=/opt/cad-fem \
      -DCMAKE_INSTALL_PREFIX=/opt/cad-fem \
      -DCAD_FEM_BUILD_TESTS=ON \
  && cmake --build /build/cad-fem-native --parallel \
  && ctest --test-dir /build/cad-fem-native --output-on-failure \
  && cmake --install /build/cad-fem-native

FROM ubuntu:24.04 AS runtime
ARG DEBIAN_FRONTEND=noninteractive
ARG AWS_CLI_VERSION=2.35.24
ARG AWS_CLI_SHA256=d71b4388a3f9e2c56819de40936b018674b04352766eef615b444c4c38b043d7
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libblas3 \
    libfontconfig1 \
    libfreetype6 \
    libgl1 \
    libgomp1 \
    liblapack3 \
    libmetis5 \
    libx11-6 \
    libxext6 \
    libxmu6 \
    jq \
    tcl8.6 \
    tk8.6 \
    unzip \
  && curl --fail --location --silent --show-error \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
    --output /tmp/awscliv2.zip \
  && echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check --strict \
  && unzip -q /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli \
  && rm -rf /tmp/aws /tmp/awscliv2.zip /var/lib/apt/lists/*

COPY --from=native-build /opt/cad-fem /opt/cad-fem
COPY --from=native-build /opt/cad-fem/share/licenses /usr/share/licenses/beam-calculator-cad-fem/upstream
COPY NOTICE.md THIRD_PARTY_LICENSES.md /usr/share/licenses/beam-calculator-cad-fem/
ENV LD_LIBRARY_PATH=/opt/cad-fem/lib:/opt/cad-fem/lib64
ENV OCCT_RESOURCE_PATH=/opt/cad-fem/share/opencascade/resources
ENV CSF_OCCTResourcePath=/opt/cad-fem/share/opencascade/resources
ENV CSF_PluginDefaults=/opt/cad-fem/share/opencascade/resources
ENV CSF_StandardDefaults=/opt/cad-fem/share/opencascade/resources
ENV CSF_XCAFDefaults=/opt/cad-fem/share/opencascade/resources
ENV CSF_ResourcesDefaults=/opt/cad-fem/share/opencascade/resources
ENV PATH=/opt/cad-fem/bin:${PATH}
USER 65532:65532
ENTRYPOINT ["cad-fem-batch-runner"]
