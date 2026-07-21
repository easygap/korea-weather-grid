package io.github.easygap.weathergrid.exception;

/** 상류 기상자료를 신뢰할 수 있게 가져오지 못했을 때 사용하는 운영 오류. */
public class WeatherDataUnavailableException extends RuntimeException {
    public WeatherDataUnavailableException(String message) {
        super(message);
    }
}
