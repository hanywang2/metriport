import { DefaultProvider } from "../../pages/connect/components/connect-providers";

const providers: DefaultProvider[] = [
  { name: "fitbit", image: "fitbit.webp" },
  { name: "oura", image: "oura.webp" },
  { name: "cronometer", image: "cronometer.webp" },
  { name: "whoop", image: "whoop.png" },
  { name: "withings", image: "withings.png" },
  { name: "garmin", image: "garmin.webp" },
];

const providersLocalStorageKey = "providers";


export const getProviders = (searchProviders: string | null, isDemo: boolean): DefaultProvider[] => {
  const validProviders = getValidProviders(searchProviders);

  if (validProviders) {
    if (!isDemo) {
      localStorage.setItem(providersLocalStorageKey, JSON.stringify(validProviders));
    }

    return validProviders;
  }

  const localProviders = getLocalStorageProviders();

  if (localProviders) {
    return localProviders;
  }

  return providers;
};

const getValidProviders = (searchProviders: string | null) => {
  if (searchProviders) {
    const providerArr = searchProviders.split(",");
    const validProviders = providers.filter((provider) =>
      providerArr.includes(provider.name)
    );

    if (validProviders.length) {
      return validProviders;
    }

    return providers;
  }

  return null;
};

const getLocalStorageProviders = (): DefaultProvider[] | null => {
  const localStorageProviders = localStorage.getItem(
    providersLocalStorageKey
  );

  if (localStorageProviders) {
    const parsedValue = JSON.parse(localStorageProviders);
    return parsedValue;
  }

  return null;
};